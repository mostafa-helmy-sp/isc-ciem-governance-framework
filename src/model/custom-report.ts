export class CustomReport {
    reportName: string
    filter: string
    includeAccessPaths?: boolean
    csp?: string
    service?: string

    constructor(reportName: string, filter: string, includeAccessPaths?: boolean, csp?: string, service?: string) {
        this.reportName = reportName
        this.filter = filter
        this.includeAccessPaths = includeAccessPaths
        this.csp = csp
        this.service = service
    }
}