import { Logger } from 'pino'
import path from 'path'
import config from '../../config.json'
import { IscService } from './isc-service'
import { FsService } from './fs-service'
import * as logSrv from './log-service'
import * as arrayFunc from '../func/array-func'
import { AccountType } from '../enum/acc-type'
import { CorrelatedIdentity } from '../model/correlated-identity'
import { Account, IdentityDocument } from 'sailpoint-api-client'
import { CiemService } from './ciem-service'
import { AccessPath } from '../model/access-paths'

// Get CIEM Config Object
var ciemConfig = config.CiemConfig
var identifiedReportNamePrefix = "identified_"
var accessPathReportNamePrefix = "with_access_paths_"
var defaultChunkSize = 75

export class ReportService {
    private logger: Logger
    private ciemSrv: CiemService
    private iscSrv: IscService
    private fsSrv: FsService
    private identitiesMap: Map<string, CorrelatedIdentity>

    constructor(logLevel?: string) {
        this.logger = logSrv.getLogger(logLevel)
        // Initialize Services
        this.ciemSrv = new CiemService(config.logLevel)
        this.iscSrv = new IscService(config.logLevel)
        this.fsSrv = new FsService(config.logLevel)
        this.identitiesMap = new Map<string, CorrelatedIdentity>()
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

    getOutputReportsDir(): string {
        return path.join(this.getWorkingDirectory(), ciemConfig.OutputReportsDir)
    }

    getOutputResourceAccessReportDir(): string {
        return path.join(this.getOutputReportsDir(), ciemConfig.ResourceAccessReportDir)
    }

    getOutputUnusedAccessReportDir(): string {
        return path.join(this.getOutputReportsDir(), ciemConfig.UnusedAccessReportDir)
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
                const account = arrayFunc.findObjectAttribute(accounts, "nativeIdentity", accountNativeId)
                if (account) {
                    correlatedIdentity = new CorrelatedIdentity(AccountType.UNCORRELATED, account)
                    if (identities && !account.uncorrelated && account.identityId) {
                        const identity = arrayFunc.findObjectAttribute(identities, "id", account.identityId)
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
        this.logger.info(`Reading Report [${report}]`)
        const resourceAccessReportRecords = this.fsSrv.readCsvFileToObject(directory, report)
        if (!resourceAccessReportRecords) {
            this.logger.error(`Unable to read report: [${report}]`)
            return
        }
        return resourceAccessReportRecords
    }

    // Fetch Correlated Identity details in bulk for a single report
    async identifyReport(directory: string, report: string, includeAccessPaths: boolean): Promise<any[] | undefined> {
        const resourceAccessReportRecords = this.readReport(directory, report)
        if (!resourceAccessReportRecords) return
        // Find unique list of AccountIDs in report
        const accountNativeIds = arrayFunc.buildAttributeArray(resourceAccessReportRecords, "AccountId", true)
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
                const correlatedAccounts = arrayFunc.filterArrayByObjectBooleanAttribute(accounts, "uncorrelated", false)
                this.logger.debug(`Only [${correlatedAccounts.length}] New ISC Accounts are correlated for Report [${report}]`)
                const identityIds = arrayFunc.buildAttributeArray(correlatedAccounts, "identityId", true)
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
        const identifiedResourceAccessReportRecords: any[] = []
        this.logger.info(`Creating identified report ${includeAccessPaths ? `including Access Paths ` : ``}for Report [${report}]`)
        for (const resourceAccessReportRecord of resourceAccessReportRecords) {
            // Fetch CorrelatedIdentity object from map
            let correlatedIdentity = this.identitiesMap.get(resourceAccessReportRecord.AccountId) || new CorrelatedIdentity(AccountType.UNKNOWN)
            let identifiedResourceAccessReportRecord = { ...correlatedIdentity.identityAttributes, ...resourceAccessReportRecord, ...correlatedIdentity.accountAttributes }
            if (includeAccessPaths) {
                let accessPaths = [new AccessPath()]
                // Only attempt to calculate the access path for known accounts
                if (correlatedIdentity.type != AccountType.UNKNOWN) {
                    let fetchedAccessPaths = await this.ciemSrv.getResourceAccessPathsForAccount(resourceAccessReportRecord.AccountId, "User", resourceAccessReportRecord.AccountSourceType, resourceAccessReportRecord.Service, resourceAccessReportRecord.ResourceType, resourceAccessReportRecord.ResourceId)
                    // Use fetched Access Path if found
                    if (fetchedAccessPaths) accessPaths = fetchedAccessPaths
                }
                accessPaths.forEach(accessPath => {
                    identifiedResourceAccessReportRecords.push({ ...identifiedResourceAccessReportRecord, AccessPath: accessPath.toString() })
                });
            } else {
                identifiedResourceAccessReportRecords.push(identifiedResourceAccessReportRecord)
            }
        }
        return identifiedResourceAccessReportRecords
    }

    writeReport(directory: string, reportName: string, reportRecords: any[]) {
        this.logger.debug(`Writing Report [${reportName}]`)
        this.fsSrv.writeObjectToCsvFile(directory, reportName, reportRecords)
    }

    async createIdentifiedResourceAccessReport(inResourceAccessReportsDir: string, resourceAccessReportFile: string, outResourceAccessReportsDir: string, reportNamePrefix: string, includeAccessPaths: boolean) {
        // Process report and add included identity attributes
        const identifiedResourceAccessReportRecords = await this.identifyReport(inResourceAccessReportsDir, resourceAccessReportFile, includeAccessPaths)
        if (!identifiedResourceAccessReportRecords) {
            this.logger.error(`Error creating Identified Report for [${resourceAccessReportFile}]`)
            return
        }
        // Write new report to output file
        this.writeReport(outResourceAccessReportsDir, `${reportNamePrefix}${resourceAccessReportFile}`, identifiedResourceAccessReportRecords)
    }

    // Add Identity Details
    async createIdentifiedResourceAccessReports(includeAccessPaths: boolean) {
        this.logger.info(this.fsSrv.listFilesInDirectory(this.getInputReportsDir()), `Input Reports Dir Contents`)
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
        this.logger.info(resourceAccessReportFiles, `Resource Access Dir Contents`)
        if (resourceAccessReportFiles) {
            // Set Output Report Name Prefixes
            let reportNamePrefix = identifiedReportNamePrefix
            if (includeAccessPaths) {
                reportNamePrefix += accessPathReportNamePrefix
            }
            for (const resourceAccessReportFile of resourceAccessReportFiles) {
                // Create each Identified Resource Access report
                await this.createIdentifiedResourceAccessReport(inResourceAccessReportsDir, resourceAccessReportFile, outResourceAccessReportsDir, reportNamePrefix, includeAccessPaths)
            }
        }
    }

}