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
    const fullReport = reportSrv.readReport(reportSrv.getOutputResourceAccessReportDir(), 'azure_Microsoft.Compute_resource_access.csv')
    if (!fullReport) return
    logger.info(`Unfiltered report has ${fullReport.length} records`)
    const filteredReport = arrayFunc.filterArrayByFilterString(fullReport, `record.AccessLevel.includes('A') && record.IdentityLifecycleState === 'inactive'`)
    logger.info(`Filtered report has ${filteredReport.length} records`)
    const filteredReportWithAccessPaths = await reportSrv.addAccessPaths(filteredReport)
    reportSrv.writeReport(reportSrv.getCustomOutputReportsDir(), 'terminated_azure_Microsoft.Compute_admins.csv', filteredReportWithAccessPaths)

    logger.info('##### End Processing #####')
}

process()