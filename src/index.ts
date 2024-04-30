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

    // let cloudEnabledEntitlements = await ciemSrv.getCloudEnabledEntitlementsForAccount("5e01a935cef54b60a6f4cc24cd2b5f54")
    // console.log(JSON.stringify(cloudEnabledEntitlements))

    // let accessPaths = await ciemSrv.getResourceAccessPathsForAccount("arn:aws:iam::699264236613:user/Craig.Hart", "User", "AWS", "lambda", "Function", "arn:aws:lambda:us-east-1:699264236613:function:s3_log")
    // accessPaths?.forEach(accessPath => {
    //     console.log(`${accessPath.toString(false)}\n`)
    // });

    await reportSrv.identifyResourceAccessReports(false)

    logger.info('##### End Processing #####')
}

process()