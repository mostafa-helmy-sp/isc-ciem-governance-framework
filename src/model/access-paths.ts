import config from '../../config.json'

var ciemConfig = config.CiemConfig

export class AccessPathStep {
    csp: string
    type: string
    id: string
    name: string

    constructor(accessPathStep: string) {
        try {
            const accessPathStepFields = accessPathStep.split(ciemConfig.AccessPathStepSeparator)
            this.csp = accessPathStepFields[0]
            this.type = accessPathStepFields[1]
            this.id = accessPathStepFields[2]
            this.name = accessPathStepFields[3]
        } catch (error) {
            this.csp = ''
            this.type = ''
            this.id = ''
            this.name = ''
        }
    }

    toString(includeId?: boolean, enclose?: boolean): string {
        let string = `${this.name} (${this.csp} ${this.type}${includeId ? ` - ${this.id}` : ''})`
        if (enclose) return `[${string}]`
        return string
    }
}

export class AccessPath {
    accessPathSteps: AccessPathStep[]

    constructor(accessPath: string) {
        this.accessPathSteps = []
        try {
            const decodedAccessPath = decodeURIComponent(accessPath)
            const rawAccessPathSteps = decodedAccessPath.split(ciemConfig.AccessPathSeparator)
            rawAccessPathSteps.forEach(rawAccessPathStep => {
                this.accessPathSteps.push(new AccessPathStep(rawAccessPathStep))
            });
        } catch (error) { }
    }

    toString(includeIds?: boolean): string {
        let string = ""
        this.accessPathSteps.forEach(accessPathStep => {
            string += `>> ${accessPathStep.toString(includeIds)} `
        });
        return string.trim()
    }
}