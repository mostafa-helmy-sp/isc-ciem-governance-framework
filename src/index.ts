import config from '../config.json'
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

    // Filter applied to a specific CSP + Service Report with Access Paths included
    let reportName = 'terminated_aws_lambda_admins.csv'
    let filter = `record.AccessLevel.includes('A') && record.IdentityLifecycleState === 'inactive'`
    let includeAccessPaths = true
    let csp = 'aws'
    let service = 'lambda'
    await reportSrv.createCustomReport(reportName, filter, includeAccessPaths, csp, service)

    // Filter for a specific Identity across all CSP/Service Reports with Access Paths included
    reportName = 'all_access_Juan.Hamilton.csv'
    filter = `record.IdentityUsername === 'Juan.Hamilton'`
    includeAccessPaths = true
    await reportSrv.createCustomReport(reportName, filter, includeAccessPaths)

    // Filter for a specific Resource across all CSP Identities & User Accounts with Access Paths included
    reportName = 's3_bucket_quolux-2090_access.csv'
    filter = `record.ResourceId === 'arn:aws:s3:::quolux-2090'`
    includeAccessPaths = true
    await reportSrv.createCustomReport(reportName, filter, includeAccessPaths)

    // Filter across all CSP/Service Reports without Access Paths
    reportName = 'finance_csp_admins.csv'
    filter = `record.AccessLevel.includes('A') && record.IdentityDepartment === 'Finance'`
    await reportSrv.createCustomReport(reportName, filter, includeAccessPaths)

    logger.info('##### End Processing #####')
}

process()