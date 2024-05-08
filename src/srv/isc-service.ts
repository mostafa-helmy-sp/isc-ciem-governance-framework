import { Logger } from 'pino'
import {
    Account,
    AccountsApi,
    Configuration,
    EntitlementDocument,
    EntitlementDto,
    IdentityDocument,
    Index,
    Paginator,
    Search,
    SearchApi,
    Source,
    SourcesApi,
    axiosRetry
} from 'sailpoint-api-client'
import * as arrayFunc from '../func/array-func'
import * as logSrv from './log-service'

function createIscApiConfig(logger: Logger): Configuration {
    const apiConfig = new Configuration()
    apiConfig.retriesConfig = {
        retries: 10,
        retryDelay: (retryCount, error) => axiosRetry.exponentialDelay(retryCount, error, 2000),
        retryCondition: (error) => {
            return error.response?.status === 429;
        },
        onRetry: (retryCount, error, requestConfig) => {
            logger.debug(`Retrying API [${requestConfig.url}] due to request error: [${error}]. Try number [${retryCount}]`)
        }
    }
    return apiConfig
}

export class IscService {
    private logger: Logger
    private apiConfig: Configuration
    private parallelProcessing: boolean

    constructor(logLevel?: string, parallelProcessing?: boolean) {
        this.logger = logSrv.getLogger(logLevel)
        this.apiConfig = createIscApiConfig(this.logger)
        this.parallelProcessing = parallelProcessing || false
    }

    getApiConfig(): Configuration {
        return this.parallelProcessing ? createIscApiConfig(this.logger) : this.apiConfig
    }

    // List Sources by Source Name
    async listSourcesByNames(sourceNames: string[]): Promise<Source[] | undefined> {
        if (!sourceNames || sourceNames.length == 0) {
            return
        }
        const sourcesFilter = arrayFunc.buildQueryOrFilter(sourceNames, "", ", ", true, "name in (", ")")
        const sourcesApi = new SourcesApi(this.getApiConfig())
        try {
            const sources = await Paginator.paginate(sourcesApi, sourcesApi.listSources, { filters: sourcesFilter })
            return sources.data
        } catch (error) {
            logSrv.logStandardApiError(this.logger, error, "Sources", `finding Sources by filter`)
            return
        }
    }

    // Return array of Source IDs from Source Names
    async getSourceIdsByNames(sourceNames: string[]): Promise<string[] | undefined> {
        if (!sourceNames || sourceNames.length == 0) return
        const sources = await this.listSourcesByNames(sourceNames)
        if (!sources) return
        this.logger.debug(`Found a total of [${sources.length}] Sources`)
        return arrayFunc.buildIdArray(sources)
    }

    // Search for Identity by Search Query
    async searchIdentitiesByQuery(identitySearchQuery: string, includedAttributes?: string[]): Promise<IdentityDocument[] | undefined> {
        if (!identitySearchQuery) return
        const searchApi = new SearchApi(this.getApiConfig())
        const search: Search = {
            indices: [
                Index.Identities
            ],
            query: {
                query: identitySearchQuery
            },
            queryResultFilter: {
                includes: includedAttributes
            },
            sort: ["id"]
        }
        try {
            const searchResult = (await Paginator.paginateSearchApi(searchApi, search, 10000)).data as IdentityDocument[]
            return searchResult
        } catch (error) {
            logSrv.logStandardApiError(this.logger, error, "Search", `searching Identities by query`, search)
            return
        }
    }

    // Return Identity from Search Query by ID
    async searchIdentityById(identityId: string, includedAttributes?: string[]): Promise<IdentityDocument | undefined> {
        const identitySearchQuery = `id:"${identityId}"`
        const results = await this.searchIdentitiesByQuery(identitySearchQuery, includedAttributes)
        if (results && results.length > 0) {
            return results[0]
        } else {
            return
        }
    }

    // Return array of Identity IDs from Search Query
    async searchIdentitiesByIds(identityIds: string[], includedAttributes?: string[]): Promise<IdentityDocument[] | undefined> {
        if (!identityIds) return
        const identitySearchQuery = arrayFunc.buildQueryOrFilter(identityIds, "id:", " OR ", false)
        return await this.searchIdentitiesByQuery(identitySearchQuery, includedAttributes)
    }

    // Return array of Identity IDs from Search Query
    async getIdentityIdsBySearchQuery(identitySearchQuery: string): Promise<string[] | undefined> {
        if (!identitySearchQuery) return
        const identities = await this.searchIdentitiesByQuery(identitySearchQuery)
        if (!identities) return
        this.logger.debug(`Found a total of [${identities.length}] Identities`)
        return arrayFunc.buildIdArray(identities)
    }

    // List Accounts by Generic Filter
    async listAccountsByFilter(accountsFilter: string): Promise<Account[] | undefined> {
        const accountsApi = new AccountsApi(this.getApiConfig())
        try {
            const accounts = await Paginator.paginate(accountsApi, accountsApi.listAccounts, { filters: accountsFilter })
            return accounts.data
        } catch (error) {
            logSrv.logStandardApiError(this.logger, error, "Accounts", `listing Accounts by filter`)
            return
        }
    }

    // List Account by Native Identity
    async listAccountByNativeIdentity(nativeIdentity: string, correlated?: boolean): Promise<Account | undefined> {
        let accountsFilter = `nativeIdentity eq "${nativeIdentity}"`
        if (correlated) {
            accountsFilter += " and uncorrelated eq false"
        }
        const results = await this.listAccountsByFilter(accountsFilter)
        if (!results || results.length == 0) {
            return
        } else {
            return results[0]
        }
    }

    // List Accounts by Native Identities
    async listAccountsByNativeIdentities(nativeIdentities: string[], correlated?: boolean, chunkSize?: number): Promise<Account[] | undefined> {
        if (!nativeIdentities || nativeIdentities.length == 0) return
        if (!chunkSize) {
            chunkSize = nativeIdentities.length
        }
        let index = 0
        let accounts: Account[] = []
        while (index < nativeIdentities.length) {
            // Get chunk of IDs and move the index
            const endIndex = Math.min(index + chunkSize, nativeIdentities.length)
            const nativeIdentitiesChunk = nativeIdentities.slice(index, endIndex)
            index += chunkSize
            let accountsFilter = arrayFunc.buildQueryOrFilter(nativeIdentitiesChunk, "", ", ", true, "nativeIdentity in (", ")")
            if (correlated) {
                accountsFilter += " and uncorrelated eq false"
            }
            const results = await this.listAccountsByFilter(accountsFilter)
            // Merge results with all accounts
            if (results && results.length > 0) {
                accounts = arrayFunc.mergeArrays(accounts, results)
            }
        }
        return accounts
    }

    // List Accounts by Identity and Source IDs
    async listAccountsByIdentityAndSourceIds(identityId: string, sourceIds: string[]): Promise<Account[] | undefined> {
        if (!identityId || !sourceIds || sourceIds.length == 0) return
        const accountsFilter = `identityId eq "${identityId}" and ${arrayFunc.buildQueryOrFilter(sourceIds, "", ", ", true, "sourceId in (", ")")}`
        return await this.listAccountsByFilter(accountsFilter)
    }

    // List Accounts by Identity ID and Source Names
    async listAccountsByIdentityIdAndSourceNames(identityId: string, sourceNames: string[]): Promise<Account[] | undefined> {
        if (!identityId) return
        const sourceIds = await this.getSourceIdsByNames(sourceNames)
        if (!sourceIds || sourceIds.length == 0) return
        return await this.listAccountsByIdentityAndSourceIds(identityId, sourceIds)
    }

    // List Entitlements by Account ID
    async listEntitlementsByAccountId(accountId: string): Promise<EntitlementDto[] | undefined> {
        const accountsApi = new AccountsApi(this.getApiConfig())
        try {
            const entitlements = await Paginator.paginate(accountsApi, accountsApi.getAccountEntitlements, { id: accountId })
            // Check if no entitlement exists
            return entitlements.data
        } catch (error) {
            logSrv.logStandardApiError(this.logger, error, "Accounts", `finding Entitlements for account [${accountId}]`)
            return
        }
    }

    // Search Entitlements by Query
    async searchEntitlementsByQuery(entitlementsQuery: string): Promise<EntitlementDocument[] | undefined> {
        const searchApi = new SearchApi(this.getApiConfig())
        const search: Search = {
            indices: [
                Index.Entitlements
            ],
            query: {
                query: entitlementsQuery
            },
            sort: ["id"]
        }
        try {
            const searchResult = (await Paginator.paginateSearchApi(searchApi, search, 10000)).data as EntitlementDocument[]
            return searchResult
        } catch (error) {
            logSrv.logStandardApiError(this.logger, error, "Search", `searching Entitlements by query`, search)
            return
        }
    }

    // Filter incoming list of cloud entitlements by cloudGoverned
    filterSearchResultsbyCloudEnabled(entitlements: EntitlementDocument[]): EntitlementDocument[] | undefined {
        if (entitlements && entitlements.length > 0) {
            const cloudEnabledEntitlements = entitlements.filter(entitlement => entitlement.cloudGoverned)
            if (cloudEnabledEntitlements && cloudEnabledEntitlements.length > 0) {
                this.logger.debug(`Found a total of [${cloudEnabledEntitlements.length}] Cloud Enabled Entitlements`)
                return cloudEnabledEntitlements
            }
        }
        return
    }

    // Filter incoming list of cloud entitlements by cloudGoverned
    filterAccountEntitlementsbyCloudEnabled(entitlements: EntitlementDto[]): EntitlementDto[] | undefined {
        if (entitlements && entitlements.length > 0) {
            const cloudEnabledEntitlements = entitlements.filter(entitlement => entitlement.cloudGoverned)
            if (cloudEnabledEntitlements && cloudEnabledEntitlements.length > 0) {
                this.logger.debug(`Found a total of [${cloudEnabledEntitlements.length}] Cloud Enabled Entitlements`)
                return cloudEnabledEntitlements
            }
        }
        return
    }

    // Search Cloud Enabled Entitlements from specific Source IDs 
    async searchCloudEnabledEntitlements(sourceNames: string[]): Promise<EntitlementDocument[] | undefined> {
        const sourceIds = await this.getSourceIdsByNames(sourceNames)
        if (!sourceIds || sourceIds.length == 0) return
        const entitlementsQuery = arrayFunc.buildQueryOrFilter(sourceIds, "source.id:", " OR ", false)
        const entitlements = await this.searchEntitlementsByQuery(entitlementsQuery)
        if (entitlements && entitlements.length > 0) {
            this.logger.debug(`Found a total of [${entitlements.length}] Entitlements`)
            const cloudEnabledEntitlements = this.filterSearchResultsbyCloudEnabled(entitlements)
            if (cloudEnabledEntitlements && cloudEnabledEntitlements.length > 0) return cloudEnabledEntitlements
            else this.logger.debug(`No Cloud Enabled Entitlements found using Search API with query: [${entitlementsQuery}]`)
        }
        return
    }

    // Find all cloudGoverned access belonging to a specific account
    async listCGEntitlementsForAccount(accountId: string): Promise<EntitlementDto[] | undefined> {
        if (!accountId) return
        const entitlements = await this.listEntitlementsByAccountId(accountId)
        if (entitlements && entitlements.length > 0) {
            this.logger.debug(`Found a total of [${entitlements.length}] Entitlements`)
            const cloudEnabledEntitlements = this.filterAccountEntitlementsbyCloudEnabled(entitlements)
            if (cloudEnabledEntitlements && cloudEnabledEntitlements.length > 0) return cloudEnabledEntitlements
            else this.logger.debug(`No Cloud Enabled Entitlements found using Accounts API for accountId: [${accountId}]`)
        }
        return
    }

    // Find all cloudGoverned access belonging to a specific account
    async listCloudEntitlementForAccount(accountId: string, entitlementValue: string): Promise<EntitlementDto | undefined> {
        if (!accountId || !entitlementValue) return
        const entitlements = await this.listEntitlementsByAccountId(accountId)
        if (entitlements && entitlements.length > 0) {
            this.logger.debug(`Found a total of [${entitlements.length}] Entitlements`)
            const cloudEntitlements = arrayFunc.filterArrayByObjectStringAttribute(entitlements, 'value', entitlementValue)
            if (cloudEntitlements && cloudEntitlements.length > 0) return cloudEntitlements[0]
            else this.logger.debug(`Cloud Entitlement [${entitlementValue}] not found found using Accounts API for accountId: [${accountId}]`)
        }
        return
    }

    // Find accounts belonging to this identity in the specified sources then pull all their cloudGoverned access
    async listCGEntitlementsForIdentity(identityId: string, sourceNames: string[]): Promise<EntitlementDto[] | undefined> {
        const accounts = await this.listAccountsByIdentityIdAndSourceNames(identityId, sourceNames)
        if (!accounts || accounts.length == 0) return
        const accountIds = arrayFunc.buildIdArray(accounts)
        let cloudEnabledEntitlements: EntitlementDto[] = []
        for (const accountId of accountIds) {
            const accountEntitlements = await this.listCGEntitlementsForAccount(accountId)
            if (accountEntitlements) cloudEnabledEntitlements = arrayFunc.mergeArraysDeduplicateById(cloudEnabledEntitlements, accountEntitlements)
        }
        return cloudEnabledEntitlements
    }

    // Find all the cloudGoverned access from specified identity and source IDs
    async listCGEntitlementsForIdentitiesBySourceIds(identityIds: string[], sourceIds: string[]): Promise<EntitlementDto[] | undefined> {
        if (!identityIds || identityIds.length == 0 || !sourceIds || sourceIds.length == 0) return
        let cloudEnabledEntitlements: EntitlementDto[] = []
        for (const identityId of identityIds) {
            this.logger.debug(`Processing Identity: [${identityId}]`)
            const accounts = await this.listAccountsByIdentityAndSourceIds(identityId, sourceIds)
            if (!accounts || accounts.length == 0) return
            const accountIds = arrayFunc.buildIdArray(accounts)
            for (const accountId of accountIds) {
                this.logger.debug(`Processing Account: [${accountId}] for Identity: [${identityId}]`)
                const accountEntitlements = await this.listCGEntitlementsForAccount(accountId)
                if (accountEntitlements) cloudEnabledEntitlements = arrayFunc.mergeArraysDeduplicateById(cloudEnabledEntitlements, accountEntitlements)
            }
        }
        return cloudEnabledEntitlements
    }

    // Find all the cloudGoverned access from specified identities and sources
    async listCGEntitlementsForIdentitiesBySourceNames(identityIds: string[], sourceNames: string[]): Promise<EntitlementDto[] | undefined> {
        const sourceIds = await this.getSourceIdsByNames(sourceNames)
        if (!sourceIds || sourceIds.length == 0) return
        return await this.listCGEntitlementsForIdentitiesBySourceIds(identityIds, sourceIds)
    }

    // Find all the cloudGoverned access from specified identity search query and sources
    async listCGEntitlementsForSearchIdentitiesBySourceNames(identitySearchQuery: string, sourceNames: string[]): Promise<EntitlementDto[] | undefined> {
        const identityIds = await this.getIdentityIdsBySearchQuery(identitySearchQuery)
        if (!identityIds || identityIds.length == 0) return
        return await this.listCGEntitlementsForIdentitiesBySourceNames(identityIds, sourceNames)
    }

}