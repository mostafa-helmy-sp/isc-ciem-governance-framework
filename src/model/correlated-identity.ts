import { Account, IdentityDocument, IdentityDocumentAllOfIdentityProfile, IdentityDocumentAllOfManager, IdentityDocumentAllOfSource } from 'sailpoint-api-client'
import config from '../../config.json'
import pino from 'pino'
import { AccountType } from '../enum/acc-type'

var ATTRIBUTES_PREFIX = 'attributes.'
var MANAGER_PREFIX = 'manager.'
var SOURCE_PREFIX = 'source.'
var IDENTITY_PROFILE_PREFIX = 'identityProfile.'

var logger = pino({
    level: config.logLevel,
    formatters: {
        level(label, number) {
            return { level: label }
        }
    },
    timestamp: true
})

export class CorrelatedIdentity {
    id: string
    type: AccountType
    identityAttributes: Record<string, string>
    accountAttributes: Record<string, string>

    constructor(accountType: AccountType, identity?: IdentityDocument, account?: Account) {
        this.type = accountType
        this.identityAttributes = {}
        this.accountAttributes = {}
        const includedAttributes = config.CiemConfig.IncludedIdentityAttributes
        // Set Included Identity Attributes
        if (!identity) {
            // Set id to AccountType when no identity supplied
            this.id = accountType
            // Loop each included identity attribute
            Object.keys(includedAttributes).forEach(includedAttributeName => {
                const attributeDisplayName = includedAttributes[includedAttributeName as keyof typeof config.CiemConfig.IncludedIdentityAttributes]
                this.identityAttributes[attributeDisplayName] = accountType
            });
        } else {
            this.id = identity.id
            // Loop each included identity attribute
            Object.keys(includedAttributes).forEach(includedAttributeName => {
                try {
                    const attributeDisplayName = includedAttributes[includedAttributeName as keyof typeof config.CiemConfig.IncludedIdentityAttributes]
                    let value = ""
                    if (includedAttributeName.startsWith(ATTRIBUTES_PREFIX)) {
                        // Handle IdentityDocument nested attributes "attributes.xxx"
                        const subAttributeName = includedAttributeName.replace(ATTRIBUTES_PREFIX, "") as string
                        if (identity.attributes) {
                            value = identity.attributes[subAttributeName] as string
                        }
                    } else if (includedAttributeName.startsWith(MANAGER_PREFIX)) {
                        // Handle IdentityDocument nested manager attributes "manager.xxx"
                        const subAttributeName = includedAttributeName.replace(MANAGER_PREFIX, "")
                        if (identity.manager) {
                            const managerAttributeName = subAttributeName as keyof IdentityDocumentAllOfManager
                            value = identity.manager[managerAttributeName] as string
                        }
                    } else if (includedAttributeName.startsWith(SOURCE_PREFIX)) {
                        // Handle IdentityDocument nested source attributes "source.xxx"
                        const subAttributeName = includedAttributeName.replace(SOURCE_PREFIX, "")
                        if (identity.source) {
                            const sourceAttributeName = subAttributeName as keyof IdentityDocumentAllOfSource
                            value = identity.source[sourceAttributeName] as string
                        }
                    } else if (includedAttributeName.startsWith(IDENTITY_PROFILE_PREFIX)) {
                        // Handle IdentityDocument nested identity profile attributes "identityProfile.xxx"
                        const subAttributeName = includedAttributeName.replace(IDENTITY_PROFILE_PREFIX, "")
                        if (identity.identityProfile) {
                            const identityProfileAttributeName = subAttributeName as keyof IdentityDocumentAllOfIdentityProfile
                            value = identity.identityProfile[identityProfileAttributeName] as string
                        }
                    } else {
                        // Handle IdentityDocument top level attributes
                        const attributeName = includedAttributeName as keyof IdentityDocument
                        value = identity[attributeName] as string
                    }
                    this.identityAttributes[attributeDisplayName] = value
                } catch (error) {
                    logger.error(`Unable to parse Identity Attribute [${JSON.stringify(includedAttributeName)}] with error: [${error instanceof Error ? error.message : error}]`)
                }
            });
        }
        // Set Key Account Attributes
        if (account && account.id) {
            this.accountAttributes.AccountInternalID = account.id
            this.accountAttributes.AccountDisplayName = account.name
        } else {
            this.accountAttributes.AccountInternalID = accountType
            this.accountAttributes.AccountDisplayName = accountType
        }
    }

    isUnknown(): boolean {
        return this.type == AccountType.UNKNOWN
    }

    isUncorrelated(): boolean {
        return this.type == AccountType.UNCORRELATED
    }
}