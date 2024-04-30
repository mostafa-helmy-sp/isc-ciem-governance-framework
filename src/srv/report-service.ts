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

// Get CIEM Config Object
var ciemConfig = config.CiemConfig
var identifiedReportNamePrefix = "identified_"
var accessPathReportNamePrefix = "identified_"
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
                    correlatedIdentity = new CorrelatedIdentity(AccountType.UNCORRELATED)
                    if (identities && !account.uncorrelated && account.identityId) {
                        const identity = arrayFunc.findObjectAttribute(identities, "id", account.identityId)
                        if (identity) {
                            correlatedIdentity = new CorrelatedIdentity(AccountType.CORRELATED, identity, account)
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

    // Fetch Correlated Identity details in bulk for a single report
    async identifyReportBulk(directory: string, report: string, includeAccessPaths: boolean): Promise<any[] | undefined> {
        this.logger.info(`Reading Resource Access Report [${report}]`)
        const resourceAccessReportRecords = this.fsSrv.readCsvFileToObject(directory, report)
        if (!resourceAccessReportRecords) {
            this.logger.error(`Unable to read report: [${report}]`)
            return
        }
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
        this.logger.info(`Creating identified report ${includeAccessPaths ? `including Access Paths` : ``}for Report [${report}]`)
        for (const resourceAccessReportRecord of resourceAccessReportRecords) {
            // Fetch CorrelatedIdentity object from map
            let correlatedIdentity = this.identitiesMap.get(resourceAccessReportRecord.AccountId) || new CorrelatedIdentity(AccountType.UNKNOWN)
            let identifiedResourceAccessReportRecord = { ...correlatedIdentity.identityAttributes, ...resourceAccessReportRecord, ...correlatedIdentity.accountAttributes }
            if (includeAccessPaths) {
                let accessPaths = await this.ciemSrv.getResourceAccessPathsForAccount(resourceAccessReportRecord.AccountId, "User", resourceAccessReportRecord.AccountSourceType
                    , resourceAccessReportRecord.Service, resourceAccessReportRecord.ResourceType, resourceAccessReportRecord.ResourceId)
                if (accessPaths) {
                    accessPaths.forEach(accessPath => {
                        identifiedResourceAccessReportRecords.push({ ...identifiedResourceAccessReportRecord, AccessPath: accessPath.toString() })
                    });
                }
            }
            identifiedResourceAccessReportRecords.push(identifiedResourceAccessReportRecord)
        }
        return identifiedResourceAccessReportRecords
    }

    // Add Identity Details
    async identifyResourceAccessReports(includeAccessPaths: boolean) {
        this.logger.info(this.fsSrv.listFilesInDirectory(ciemConfig.InputReportsDir), `Input Reports Dir Contents`)
        const inResourceAccessReportsDir = path.join(ciemConfig.InputReportsDir, ciemConfig.ResourceAccessReportDir)
        const inUnusedAccessReportsDir = path.join(ciemConfig.InputReportsDir, ciemConfig.UnusedAccessReportDir)
        const outResourceAccessReportsDir = path.join(ciemConfig.OutputReportsDir, ciemConfig.ResourceAccessReportDir)
        const outUnusedAccessReportsDir = path.join(ciemConfig.OutputReportsDir, ciemConfig.UnusedAccessReportDir)
        // Unzip Resource Access Reports
        this.fsSrv.unzipDirectoryFile(ciemConfig.InputReportsDir, ciemConfig.ResourceAccessReportName, inResourceAccessReportsDir, false)
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
                // Process report and add included identity attributes
                const identifiedResourceAccessReportRecords = await this.identifyReportBulk(inResourceAccessReportsDir, resourceAccessReportFile, includeAccessPaths)
                if (!identifiedResourceAccessReportRecords) {
                    this.logger.info(`Writing creating Identified Report for [${resourceAccessReportFile}]`)
                    continue
                }
                // Write new report to output file
                this.logger.debug(`Writing Identified Report for [${resourceAccessReportFile}]`)
                const identifiedReportName = `${reportNamePrefix}${resourceAccessReportFile}`
                this.fsSrv.writeObjectToCsvFile(outResourceAccessReportsDir, identifiedReportName, identifiedResourceAccessReportRecords)
            }
        }
    }

}