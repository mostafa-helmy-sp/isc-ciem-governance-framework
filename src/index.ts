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

    // await reportSrv.createIdentifiedResourceAccessReports(false)

    // await reportSrv.createIdentifiedResourceAccessReport(reportSrv.getInputResourceAccessReportDir(), 'aws_sns_resource_access.csv', reportSrv.getOutputResourceAccessReportDir(), 'manual_', true)

    const fullReport = reportSrv.readReport(reportSrv.getOutputResourceAccessReportDir(), 'manual_aws_sns_resource_access.csv')
    if (!fullReport) return
    logger.info(`Unfiltered report has ${fullReport.length} records`)
    const filteredReport = arrayFunc.filterArrayByFilterString(fullReport, `record.AccessLevel.includes('A') && record.ResourceName === 'sailpoint-cam-topic' && record.AccountInternalID === 'Unknown'`)
    logger.info(`Filtered report has ${filteredReport.length} records`)

    reportSrv.writeReport(reportSrv.getOutputResourceAccessReportDir(), 'filtered_aws_sns_resource_access.csv', filteredReport)

    logger.info('##### End Processing #####')
}

process()