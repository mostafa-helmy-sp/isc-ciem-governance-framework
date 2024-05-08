import { EntitlementDto } from 'sailpoint-api-client'
import config from '../../config.json'

var ciemConfig = config.CiemConfig

var defaultUnknownString = 'Unknown'

export class AccessPathStep {
    unknown: boolean
    csp: string
    type: string
    id: string
    name: string

    constructor(accessPathStep?: string) {
        try {
            if (!accessPathStep) {
                this.unknown = true
                this.csp = ''
                this.type = ''
                this.id = ''
                this.name = ''
            } else {
                this.unknown = false
                const accessPathStepFields = accessPathStep.split(ciemConfig.AccessPathStepSeparator)
                this.csp = accessPathStepFields[0]
                this.type = accessPathStepFields[1]
                this.id = accessPathStepFields[2]
                this.name = accessPathStepFields[3]
            }
        } catch (error) {
            this.unknown = true
            this.csp = ''
            this.type = ''
            this.id = ''
            this.name = ''
        }
    }

    toString(includeId?: boolean, enclose?: boolean): string {
        if (this.unknown) return defaultUnknownString
        let string = `${this.name} (${this.csp} ${this.type}${includeId ? ` - ${this.id}` : ''})`
        if (enclose) return `[${string}]`
        return string
    }
}

export class AccessPath {
    accessPathSteps: AccessPathStep[]
    directEntitlement?: EntitlementDto

    constructor(accessPath?: string) {
        this.accessPathSteps = []
        if (accessPath) {
            try {
                const decodedAccessPath = decodeURIComponent(accessPath)
                const rawAccessPathSteps = decodedAccessPath.split(ciemConfig.AccessPathSeparator)
                rawAccessPathSteps.forEach(rawAccessPathStep => {
                    this.accessPathSteps.push(new AccessPathStep(rawAccessPathStep))
                });
            } catch (error) { this.accessPathSteps.push(new AccessPathStep()) }
        } else {
            this.accessPathSteps.push(new AccessPathStep())
        }
    }

    getAccessPathEntitlementValue(): string | undefined {
        if (this.accessPathSteps.length > 1) return this.accessPathSteps[1].id
    }

    setDirectEntitlement(directEntitlement: EntitlementDto) {
        this.directEntitlement = directEntitlement
    }

    getDirectEntitlementAttributes(): Record<string, string> {
        let directEntitlementAttributes: Record<string, string> = {}
        if (this.directEntitlement) {
            directEntitlementAttributes.DirectEntitlementID = this.directEntitlement.id || defaultUnknownString
            directEntitlementAttributes.DirectEntitlementName = this.directEntitlement.name
            directEntitlementAttributes.DirectEntitlementAttribute = this.directEntitlement.attribute || defaultUnknownString
            directEntitlementAttributes.DirectEntitlementValue = this.directEntitlement.value || defaultUnknownString
        } else {
            directEntitlementAttributes.DirectEntitlementID = defaultUnknownString
            directEntitlementAttributes.DirectEntitlementName = defaultUnknownString
            directEntitlementAttributes.DirectEntitlementAttribute = defaultUnknownString
            directEntitlementAttributes.DirectEntitlementValue = defaultUnknownString
        }
        return directEntitlementAttributes
    }

    toString(includeIds?: boolean): string {
        let string = ""
        this.accessPathSteps.forEach(accessPathStep => {
            string += `>> ${accessPathStep.toString(includeIds)} `
        });
        return string.trim()
    }
}