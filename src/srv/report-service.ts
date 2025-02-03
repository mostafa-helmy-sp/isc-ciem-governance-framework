import { Logger } from 'pino'
import path from 'path'
import config from '../../config.json'
import { IscService } from './isc-service'
import { FsService } from './fs-service'
import * as logSrv from './log-service'
import * as arrayFunc from '../func/array-func'
import * as timeFunc from '../func/time-func'
import { AccountType } from '../enum/acc-type'
import { CorrelatedIdentity } from '../model/correlated-identity'
import { Account, IdentityDocument } from 'sailpoint-api-client'
import { CiemService } from './ciem-service'
import { AccessPath } from '../model/access-paths'

// Get CIEM Config Object
var ciemConfig = config.CiemConfig
var defaultChunkSize = 75

export class ReportService {
    private logger: Logger
    private ciemSrv: CiemService
    private iscSrv: IscService
    private fsSrv: FsService
    private identitiesMap: Map<string, CorrelatedIdentity>
    private cloudEnabledEntitlementsMap: Map<string, any | undefined>

    constructor(logLevel?: string) {
        this.logger = logSrv.getLogger(logLevel)
        // Initialize Services
        this.ciemSrv = new CiemService(config.logLevel)
        this.iscSrv = new IscService(config.logLevel)
        this.fsSrv = new FsService(config.logLevel)
        this.identitiesMap = new Map<string, CorrelatedIdentity>()
        this.cloudEnabledEntitlementsMap = new Map<string, any | undefined>()
    }

    getWorkingDirectory(): string {
        return ciemConfig.WorkingDir || '.'
    }

    getInputReportsDir(): string {
        return path.join(this.getWorkingDirectory(), ciemConfig.InputReportsDir)
    }

    getInputResourceAccessReportDir(): string {
        return path.join(this.getInputReportsDir(), ciemConfig.ResourceAccessReportDir)
    }

    getInputUnusedAccessReportDir(): string {
        return path.join(this.getInputReportsDir(), ciemConfig.UnusedAccessReportDir)
    }

    getCustomInputReportsDir(): string {
        return path.join(this.getInputReportsDir(), ciemConfig.CustomInputReportsDir)
    }

    getOutputReportsDir(): string {
        return path.join(this.getWorkingDirectory(), ciemConfig.OutputReportsDir)
    }

    getOutputResourceAccessReportDir(): string {
        return path.join(this.getOutputReportsDir(), ciemConfig.ResourceAccessReportDir)
    }

    getOutputUnusedAccessReportDir(): string {
        return path.join(this.getOutputReportsDir(), ciemConfig.UnusedAccessReportDir)
    }

    getCustomOutputReportsDir(): string {
        return path.join(this.getOutputReportsDir(), ciemConfig.CustomOutputReportsDir)
    }

    // Update Account NativeIdentity to CorrelatedIdentity map for Bulk Processing
    updateIdentitiesMap(accountNativeIds: string[], accounts: Account[] | undefined, identities: IdentityDocument[] | undefined) {
        for (const accountNativeId of accountNativeIds) {
            // Skip if account already in map
            if (this.identitiesMap.has(accountNativeId)) {
                continue
            }
            let correlatedIdentity = new CorrelatedIdentity(AccountType.UNKNOWN)
            if (accounts) {
                const account = arrayFunc.findObjectByAttribute(accounts, 'nativeIdentity', accountNativeId)
                if (account) {
                    correlatedIdentity = new CorrelatedIdentity(AccountType.UNCORRELATED, account)
                    if (identities && !account.uncorrelated && account.identityId) {
                        const identity = arrayFunc.findObjectByAttribute(identities, 'id', account.identityId)
                        if (identity) {
                            correlatedIdentity = new CorrelatedIdentity(AccountType.CORRELATED, account, identity)
                        } else {
                            this.logger.error(`Could not find identity with id [${account.identityId}] for account [${accountNativeId}]`)
                        }
                    } else {
                        this.logger.debug(`Uncorrelated CSP account [${accountNativeId}]`)
                    }
                } else {
                    this.logger.debug(`Unknown CSP account [${accountNativeId}]`)
                }
            }
            this.identitiesMap.set(accountNativeId, correlatedIdentity)
        }
    }

    // Read a single CSV report from the specified directory
    readReport(directory: string, report: string): any[] | undefined {
        this.logger.debug(`Reading Report [${report}]`)
        const resourceAccessReportRecords = this.fsSrv.readCsvFileToObject(directory, report)
        if (!resourceAccessReportRecords) {
            this.logger.error(`Unable to read report: [${report}]`)
            return
        }
        return resourceAccessReportRecords
    }

    // Build the key to used for finding/storing direct entitlements in the map
    getDirectEntitlementMapKey(sourceId: string, entitlementId: string) {
        return `#${sourceId}#${entitlementId}#`.toLowerCase()
    }

    // Custom logic to match the entitlement details using the access path step details
    matchDirectEntitlement(cloudEnabledEntitlements: any[], accessPath: AccessPath): any | undefined {
        let entitlementStep = accessPath.getEntitlementStep()
        let entitlementScope = accessPath.getEntitlementScopeStep()
        if (!entitlementStep) return
        // Special handling for AWS Inline Policies
        if (entitlementStep.csp === 'AWS' && entitlementStep.type === 'iam/UserInlinePolicy') {
            // From 'user-arn@policy-name' to  'user-arn:InlinePolicy:policy-name'
            return arrayFunc.findObjectByAttribute(cloudEnabledEntitlements, 'resource_id', entitlementStep.id.replace('@', ':InlinePolicy:'))
        }
        // Special handling for GCP Role Bindings
        if (entitlementStep.csp === 'GCP' && entitlementStep.type === 'PolicyBinding' && entitlementStep.name.indexOf(":") > 0 && entitlementScope) {
            // GCP Naming Convention: 'Role (on) Scope [scope type]'
            let entitlementName = `${entitlementStep.name.split(":")[1]} (on) ${entitlementScope.name} [${entitlementScope.type}]`
            return arrayFunc.findObjectByAttribute(cloudEnabledEntitlements, 'name', entitlementName)
        }
        // Special handling for Azure Role Assignments
        if (entitlementStep.csp === 'Azure' && entitlementStep.type === 'Microsoft.Authorization/roleAssignments' && entitlementScope) {
            // Azure Naming Convention: 'Role [on] Scope' 
            let entitlementName = `${entitlementStep.name} [on] ${entitlementScope.name}`
            return arrayFunc.findObjectByAttribute(cloudEnabledEntitlements, 'name', entitlementName)
        }
        return arrayFunc.findObjectByAttribute(cloudEnabledEntitlements, 'resource_id', entitlementStep.id)
    }

    // Fetch Direct Entitlement from Map or via API
    async findDirectEntitlement(accountId: string, sourceId: string, accessPath: AccessPath): Promise<any | undefined> {
        let entitlementStep = accessPath.getEntitlementStep()
        if (!entitlementStep) return
        let mapKey = this.getDirectEntitlementMapKey(sourceId, entitlementStep.id)
        // Return from map if already found
        if (this.cloudEnabledEntitlementsMap.has(mapKey)) {
            return this.cloudEnabledEntitlementsMap.get(mapKey)
        }
        // Fetch via CIEM APIs is not found already
        let cloudEnabledEntitlements = await this.ciemSrv.getCloudEnabledEntitlementsForAccount(accountId)
        if (!cloudEnabledEntitlements) return
        let directEntitlement = this.matchDirectEntitlement(cloudEnabledEntitlements, accessPath)
        this.cloudEnabledEntitlementsMap.set(mapKey, directEntitlement)
        return directEntitlement
    }

    // Include Access Paths to a single Report Record
    async addAccessPath(reportRecord: any): Promise<any[]> {
        let reportRecordWithAccessPaths: any[] = []
        let accessPaths = [new AccessPath()]
        // Only attempt to calculate the access path for known accounts
        if (reportRecord.AccountInternalID && reportRecord.AccountInternalID != AccountType.UNKNOWN) {
            let fetchedAccessPaths = await this.ciemSrv.getResourceAccessPathsForAccount(reportRecord.AccountId, 'User', reportRecord.AccountSourceType, reportRecord.Service, reportRecord.ResourceType, reportRecord.ResourceId)
            // Use fetched Access Path if found
            if (fetchedAccessPaths) accessPaths = fetchedAccessPaths
        }
        for (const accessPath of accessPaths) {
            // Fetch Direct Entitlement Details if Account is known
            if (reportRecord.AccountInternalID && reportRecord.AccountInternalID != AccountType.UNKNOWN) {
                const directEntitlement = await this.findDirectEntitlement(reportRecord.AccountInternalID, reportRecord.AccountSourceInternalID, accessPath)
                if (directEntitlement) accessPath.setDirectEntitlement(directEntitlement)
            }
            reportRecordWithAccessPaths.push({ ...reportRecord, ...accessPath.directEntitlementAttributes, AccessPath: accessPath.toString() })
        }
        return reportRecordWithAccessPaths
    }

    // Include the Identity Context to Report Records
    async addIdentityContext(reportRecords: any[], includeAccessPaths?: boolean): Promise<any[]> {
        let extendedReportRecords: any[] = []
        for (const reportRecord of reportRecords) {
            // Fetch CorrelatedIdentity object from map
            const correlatedIdentity = this.identitiesMap.get(reportRecord.AccountId) || new CorrelatedIdentity(AccountType.UNKNOWN)
            const extendedReportRecord = { ...correlatedIdentity.identityAttributes, ...reportRecord, ...correlatedIdentity.accountAttributes }
            // This should not be used but leaving in case needed in the future. Access Paths should only be included in Custom Reports.
            if (includeAccessPaths) {
                const reportRecordWithAccessPaths = await this.addAccessPath(extendedReportRecord)
                extendedReportRecords = arrayFunc.mergeArrays(extendedReportRecords, reportRecordWithAccessPaths)
            } else {
                extendedReportRecords.push(extendedReportRecord)
            }
        }
        return extendedReportRecords
    }

    // Fetch Correlated Identity details in bulk for a single report
    async extendReport(directory: string, report: string, includeAccessPaths?: boolean): Promise<any[] | undefined> {
        const resourceAccessReportRecords = this.readReport(directory, report)
        if (!resourceAccessReportRecords) return
        // Find unique list of AccountIDs in report
        const accountNativeIds = arrayFunc.buildAttributeArray(resourceAccessReportRecords, 'AccountId', true)
        this.logger.debug(`Found [${accountNativeIds.length}] Unique CSP AccountIDs from Report [${report}]`)
        // Filter to only accounts not in the map
        const newAccountNativeIds = arrayFunc.findArrayMapDifference(accountNativeIds, this.identitiesMap)
        this.logger.debug(`Found [${newAccountNativeIds.length}] New CSP AccountIDs from Report [${report}]`)
        if (newAccountNativeIds && newAccountNativeIds.length > 0) {
            const accounts = await this.iscSrv.listAccountsByNativeIdentities(newAccountNativeIds, false, defaultChunkSize)
            let identities: IdentityDocument[] | undefined
            if (accounts) {
                this.logger.debug(`Found [${accounts.length}] New ISC Accounts for Report [${report}]`)
                // Exclude uncorrelated Accounts from Identity Search
                const correlatedAccounts = arrayFunc.filterArrayByObjectBooleanAttribute(accounts, 'uncorrelated', false)
                this.logger.debug(`Only [${correlatedAccounts.length}] New ISC Accounts are correlated for Report [${report}]`)
                const identityIds = arrayFunc.buildAttributeArray(correlatedAccounts, 'identityId', true)
                const includedIdentityAttributes = Object.keys(ciemConfig.IncludedIdentityAttributes)
                identities = await this.iscSrv.searchIdentitiesByIds(identityIds, includedIdentityAttributes)
                if (!identities) {
                    this.logger.error(`Unable to find any identities from report: [${report}]`)
                } else {
                    this.logger.debug(`Found [${identities.length}] Identity for Report [${report}]`)
                }
            } else {
                this.logger.error(`Unable to find any ISC accounts from CSP accounts under report: [${report}]`)
            }

            // Update map for speed & simplicity of usage
            this.updateIdentitiesMap(newAccountNativeIds, accounts, identities)
        }
        this.logger.debug(`Identities Map size: [${this.identitiesMap.size}] following Report [${report}]`)
        const extendedResourceAccessReportRecords = await this.addIdentityContext(resourceAccessReportRecords, includeAccessPaths)
        return extendedResourceAccessReportRecords
    }

    // Include Access Paths to Report Records
    async addAccessPathParallel(reportRecords: any[]): Promise<any[]> {
        let accessPathProcessingRecords: any[] = []
        let accessPathReportRecords: any[] = []
        // Processing records asynchronously
        reportRecords.forEach(reportRecord => {
            accessPathProcessingRecords.push(this.addAccessPath(reportRecord))
        })
        // Await and push results in return array
        for (const accessPathProcessingRecord of accessPathProcessingRecords) {
            accessPathReportRecords = arrayFunc.mergeArrays(accessPathReportRecords, await accessPathProcessingRecord)
        }
        return accessPathReportRecords
    }

    // Include Access Paths to Report Records
    async addAccessPaths(reportRecords: any[], parallelProcessing?: boolean): Promise<any[]> {
        if (parallelProcessing) return await this.addAccessPathParallel(reportRecords)
        let accessPathReportRecords: any[] = []
        for (const reportRecord of reportRecords) {
            const reportRecordWithAccessPaths = await this.addAccessPath(reportRecord)
            accessPathReportRecords = arrayFunc.mergeArrays(accessPathReportRecords, reportRecordWithAccessPaths)
        }
        return accessPathReportRecords
    }

    // Write report to file
    writeReport(directory: string, reportName: string, reportRecords: any[]) {
        this.logger.debug(`Writing Report [${reportName}]`)
        this.fsSrv.writeObjectToCsvFile(directory, reportName, reportRecords)
    }

    // Write Resource Access Report to file
    writeResourceAccessReport(reportName: string, reportRecords: any[]) {
        this.writeReport(this.getOutputResourceAccessReportDir(), reportName, reportRecords)
    }

    // Write Custom Output Report to file
    writeCustomReport(reportName: string, reportRecords: any[]) {
        this.writeReport(this.getCustomOutputReportsDir(), reportName, reportRecords)
    }

    // Add Identity Details and optionally Access Paths to a single Resource Access Report
    async createExtendedResourceAccessReport(inResourceAccessReportsDir: string, resourceAccessReportFile: string, outResourceAccessReportsDir: string, includeAccessPaths?: boolean) {
        // Process report and add included identity attributes
        this.logger.info(`Creating extended report ${includeAccessPaths ? `including Access Paths ` : ``}for Report [${resourceAccessReportFile}]`)
        const extendedResourceAccessReportRecords = await this.extendReport(inResourceAccessReportsDir, resourceAccessReportFile, includeAccessPaths)
        if (!extendedResourceAccessReportRecords) {
            this.logger.error(`Error creating Extended Report for [${resourceAccessReportFile}]`)
            return
        }
        // Write new report to output file
        this.writeReport(outResourceAccessReportsDir, resourceAccessReportFile, extendedResourceAccessReportRecords)
    }

    // Add Identity Details and optionally Access Paths to all Resource Access Reports
    async createExtendedResourceAccessReports(includeAccessPaths?: boolean) {
        const inResourceAccessReportsDir = this.getInputResourceAccessReportDir()
        const inUnusedAccessReportsDir = this.getInputUnusedAccessReportDir()
        const outResourceAccessReportsDir = this.getOutputResourceAccessReportDir()
        const outUnusedAccessReportsDir = this.getOutputUnusedAccessReportDir()
        // Unzip Resource Access Reports
        this.fsSrv.unzipDirectoryFile(this.getInputReportsDir(), ciemConfig.ResourceAccessReportName, inResourceAccessReportsDir, false)
        // Cleanup Output Reports directories
        this.fsSrv.cleanupDirectory(outResourceAccessReportsDir)
        this.fsSrv.cleanupDirectory(outUnusedAccessReportsDir)
        const resourceAccessReportFiles = this.fsSrv.listCsvFilesInDirectory(inResourceAccessReportsDir)
        if (resourceAccessReportFiles) {
            for (const resourceAccessReportFile of resourceAccessReportFiles) {
                // Create each Extended Resource Access report
                await this.createExtendedResourceAccessReport(inResourceAccessReportsDir, resourceAccessReportFile, outResourceAccessReportsDir, includeAccessPaths)
            }
        }
    }

    // Default Report result when no results found
    getEmptyResult(errorMessage?: string): any[] {
        return [{ Error: (errorMessage ? errorMessage : 'No results found') }]
    }

    // Build file name match regex from input CSP & Service
    getFileMatchRegEx(csp?: string, service?: string): string {
        let regex = `${!csp || csp === '*' ? '(.*)' : csp.toLowerCase()}_(.*)${!service || service === '*' ? '' : `${service.toLowerCase()}(.*)`}_`
        return regex
    }

    // Create a custom report by filtering different Resource Access Reports 
    async searchOutputResourceAccessReports(filter: string, includeAccessPaths?: boolean, csp?: string, service?: string): Promise<any[]> {
        if (!filter) return this.getEmptyResult(`Invalid or Empty inputs. CSP: [${csp}], Service: [${service}], Filter: [${filter}]`)
        // Build file regex filter using input csp / service
        const regex = this.getFileMatchRegEx(csp, service)
        const files = this.fsSrv.filterCsvFilesByRegExInDirectory(this.getOutputResourceAccessReportDir(), regex)
        if (!files || files.length == 0) {
            const errorMessage = `File Name RegEx: [${regex}] derived from CSP: [${csp}] and Service: [${service}] matched no output resource access reports`
            this.logger.error(errorMessage)
            return this.getEmptyResult(errorMessage)
        }
        let results: any[] = []
        for (const file of files) {
            const fullReport = this.readReport(this.getOutputResourceAccessReportDir(), file)
            if (!fullReport) {
                this.logger.debug(`No records found in output resource access report: [${file}]`)
            } else {
                this.logger.debug(`Unfiltered report has ${fullReport.length} records`)
                let filteredReport = arrayFunc.filterArrayByFilterString(fullReport, filter)
                this.logger.debug(`Filtered report has ${filteredReport.length} records`)
                // Only process if filter returned results
                if (filteredReport && filteredReport.length > 0) {
                    // Include access paths if required
                    if (includeAccessPaths) {
                        filteredReport = await this.addAccessPaths(filteredReport, true)
                    }
                    results = arrayFunc.mergeArrays(results, filteredReport)
                }
            }
        }
        if (results.length > 0) return results
        else return this.getEmptyResult()
    }

    // Create and Write a Custom Report
    async createCustomReport(reportName: string, filter: string, includeAccessPaths?: boolean, csp?: string, service?: string) {
        this.logger.info(`Creating custom report ${includeAccessPaths ? `including Access Paths ` : ``}for Report [${reportName}]`)
        const startTime = Date.now()
        let filteredReport = await this.searchOutputResourceAccessReports(filter, includeAccessPaths, csp, service)
        const processEndTime = Date.now()
        this.writeCustomReport(reportName, filteredReport)
        const writeEndTime = Date.now()
        // Calculate metrics for logs
        const totalTime = timeFunc.calculateTimeDifference(startTime, writeEndTime)
        const filterTime = timeFunc.calculateTimeDifference(startTime, processEndTime)
        const writeTime = timeFunc.calculateTimeDifference(processEndTime, writeEndTime)
        this.logger.info(`Completed custom report [${reportName}] ${includeAccessPaths ? `including Access Paths` : ``} in ${totalTime} (Filtering time: ${filterTime}, Write time: ${writeTime})`)
    }
}