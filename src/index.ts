import config from '../config.json'
import * as arrayFunc from './func/array-func'
import * as logSrv from './srv/log-service'
import { IscService } from './srv/isc-service'
import { FsService } from './srv/fs-service'
import { ReportService } from './srv/report-service'
import { CiemService } from './srv/ciem-service'

// Global log level
var logger = logSrv.getLogger()

// Initialize ISC Service
var iscSrv = new IscService(config.logLevel)

// Initialize FS Service
var fsSrv = new FsService(config.logLevel)

// Initialize Reports Service
var reportSrv = new ReportService(config.logLevel)

// Initialize CIEM Service
var ciemSrv = new CiemService(config.logLevel)

async function process() {
    logger.info('##### Start Processing #####')

    await reportSrv.createIdentifiedResourceAccessReports()

    fsSrv.cleanupDirectory(reportSrv.getCustomOutputReportsDir())

    // Specific CSP+Service Report with Access Paths included
    let reportName = 'terminated_aws_lambda_admins.csv'
    let filter = `record.AccessLevel.includes('A') && record.IdentityLifecycleState === 'inactive'`
    let includeAccessPaths = true
    let csp = 'aws'
    let service = 'lambda'
    await reportSrv.createCustomReport(reportName, filter, includeAccessPaths, csp, service)

    // Specific CSP+Service Report without Access Paths
    reportName = 'terminated_csp_admins.csv'
    filter = `record.AccessLevel.includes('A') && record.IdentityLifecycleState === 'inactive'`
    includeAccessPaths = false
    csp = ''
    service = ''
    await reportSrv.createCustomReport(reportName, filter, includeAccessPaths, csp, service)

    // Example with invalid CSP / Service 
    reportName = 'invalid_csp.csv'
    filter = `record.AccessLevel.includes('A') && record.IdentityLifecycleState === 'inactive' && record.IdentityDepartment !== 'Engineering'`
    includeAccessPaths = false
    csp = 'oci'
    service = 'compute'
    await reportSrv.createCustomReport(reportName, filter, includeAccessPaths, csp, service)

    // Example filter with no results 
    reportName = 'no_results.csv'
    filter = `record.AccessLevel.includes('A') && record.IdentityLifecycleState === 'inactive' && record.IdentityDepartment !== 'Engineering'`
    includeAccessPaths = false
    csp = 'azure'
    service = 'compute'
    await reportSrv.createCustomReport(reportName, filter, includeAccessPaths, csp, service)

    logger.info('##### End Processing #####')
}

process()