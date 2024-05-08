import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import axiosRetry from 'axios-retry'
import oauth from 'axios-oauth-client'
import config from '../../config.json'
import * as logSrv from './log-service'
import { IscScope } from '../enum/isc-scope'
import { Logger } from 'pino'
import { AccessPath } from '../model/access-paths'

var ciemConfig = config.CiemConfig

export class CiemService {
    private logger: Logger
    private httpClient: AxiosInstance
    private accessToken?: string
    private tokenExpiry?: Date

    constructor(logLevel?: string) {
        this.logger = logSrv.getLogger(logLevel)
        this.httpClient = axios.create({
            baseURL: ciemConfig.CiemBaseUrl,
        })
        axiosRetry(this.httpClient, {
            retries: 10,
            retryDelay: (retryCount, error) => axiosRetry.exponentialDelay(retryCount, error, 2000),
            retryCondition: (error) => {
                return error.response?.status === 429;
            },
            onRetry: (retryCount, error, requestConfig) => {
                this.logger.debug(`Retrying API [${requestConfig.url}] due to request error: [${error}]. Try number [${retryCount}]`)
            }
        })
    }

    async authenticate(): Promise<any | undefined> {
        try {
            const getClientCredentials = oauth.clientCredentials(this.httpClient, config.BaseURL + ciemConfig.OAuthUrlPath, config.ClientId, config.ClientSecret)
            const auth = await getClientCredentials(IscScope.ADMIN)
            if (auth && auth.access_token) {
                return auth
            }
        } catch (error) {
            logSrv.logStandardApiError(this.logger, error, 'OAuth', 'authenticating')
        }
    }

    async getToken(): Promise<string | undefined> {
        // Return current token if exists & valid
        if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
            return this.accessToken
        }
        // Authenticate and get a new token otherwise
        const auth = await this.authenticate()
        if (!auth || !auth.expires_in) return
        this.tokenExpiry = new Date()
        this.tokenExpiry.setSeconds(this.tokenExpiry.getSeconds() + auth.expires_in)
        this.accessToken = auth.access_token
        return this.accessToken
    }

    async getCloudEnabledEntitlementsForAccount(accountId: string): Promise<any[] | undefined> {
        // Ensure Access Token exists
        await this.getToken()
        if (!this.accessToken) return
        // Configure the API call and perform the request
        let request: AxiosRequestConfig = {
            method: 'GET',
            url: ciemConfig.CiemBaseUrl + ciemConfig.CloudEnabledEntitlementsUrlPath,
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
            },
            params: {
                account_id: accountId
            }
        }
        try {
            const response = await this.httpClient.request(request)
            if (response.data.effective_access_supported_entitlements && Array.isArray(response.data.effective_access_supported_entitlements)) {
                return response.data.effective_access_supported_entitlements as any[]
            }
        } catch (error) {
            logSrv.logStandardApiError(this.logger, error, "Cloud Enabled Entitlements", `fetching cloud enabled entitlements for account [${accountId}]`, request)
        }
    }

    async getResourceAccessPathsForAccount(accountNativeIdentity: string, accountType: string, accountSourceType: string, serviceType: string, resourceType: string, resourceId: string): Promise<AccessPath[] | undefined> {
        // Ensure Access Token exists
        await this.getToken()
        if (!this.accessToken) return
        // Configure the API call and perform the request
        let request: AxiosRequestConfig = {
            method: 'GET',
            url: ciemConfig.CiemBaseUrl + ciemConfig.ResourceAccessPathsUrlPath,
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
            },
            params: {
                identity_native_id: accountNativeIdentity,
                identity_type: accountType,
                identity_source_type: accountSourceType,
                service_type: serviceType,
                resource_type: resourceType,
                resource_native_id: resourceId
            }
        }
        try {
            const response = await this.httpClient.request(request)
            if (response.data.effective_access_resource_access_paths && Array.isArray(response.data.effective_access_resource_access_paths)) {
                const accessPaths: AccessPath[] = []
                response.data.effective_access_resource_access_paths.forEach((accessPath: any) => {
                    accessPaths.push(new AccessPath(accessPath.path))
                });
                return accessPaths
            }
        } catch (error) {
            logSrv.logStandardApiError(this.logger, error, "Cloud Enabled Entitlements", `fetching access paths between account [${accountNativeIdentity}] and resource [${resourceId}]`, request)
            // logSrv.logStandardApiError(this.logger, error, "Cloud Enabled Entitlements", `fetching access paths between account [${accountNativeIdentity}] and resource [${resourceId}]`)
        }
    }
}