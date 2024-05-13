import { Logger } from 'pino'
import { json2csv, csv2json } from 'csv42'
import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import { FileExtenstion } from '../enum/file-extenstion'
import * as logSrv from './log-service'

export class FsService {
    private logger: Logger

    constructor(logLevel?: string) {
        this.logger = logSrv.getLogger(logLevel)
    }

    createDirectory(directoryName: string, recursive: boolean): boolean {
        try {
            // Create directory if does not exist
            if (!fs.existsSync(directoryName)) {
                fs.mkdirSync(directoryName, { recursive: recursive })
            }
            return true
        } catch (error) {
            logSrv.logStandardFsError(this.logger, error, "creating directory", `[${directoryName}] in ${recursive ? "" : "non-"}recursive mode`)
            return false
        }
    }

    deleteDirectory(directoryName: string, recursive: boolean): boolean {
        try {
            // Delete directory and recreate if exists
            if (fs.existsSync(directoryName)) {
                fs.rmSync(directoryName, { recursive: true })
            }
            return true
        } catch (error) {
            logSrv.logStandardFsError(this.logger, error, "deleting directory", `[${directoryName}] in ${recursive ? "" : "non-"}recursive mode`)
            return false
        }
    }

    cleanupDirectory(directoryName: string): boolean {
        try {
            // Delete directory and recreate if exists
            if (this.deleteDirectory(directoryName, true)) {
                return this.createDirectory(directoryName, true)
            } else {
                return false
            }
        } catch (error) {
            logSrv.logStandardFsError(this.logger, error, "cleaning up directory", `[${directoryName}]`)
            return false
        }
    }

    // Unzip file to the specified directory
    unzipFile(inFilePath: string, outDirectoryName: string, deleteExistingFiles: boolean): boolean {
        try {
            if (deleteExistingFiles) {
                if (!this.cleanupDirectory(outDirectoryName)) {
                    // Error if unable to cleanup directory
                    return false
                }
            }
            const unzip = new AdmZip(inFilePath)
            unzip.extractAllTo(outDirectoryName)
            return true
        } catch (error) {
            logSrv.logStandardFsError(this.logger, error, "extracting file", `[${inFilePath}] to directory [${outDirectoryName}]`)
            return false
        }
    }

    // Unzip file to the specified directory
    unzipDirectoryFile(inDirectoryName: string, inFileName: string, outDirectoryName: string, deleteExistingFiles: boolean): boolean {
        return this.unzipFile(path.join(inDirectoryName, inFileName), outDirectoryName, deleteExistingFiles)
    }

    // Returns a list of files in a directory
    listFilesInDirectory(directoryName: string): string[] | undefined {
        try {
            return fs.readdirSync(directoryName)
        } catch (error) {
            logSrv.logStandardFsError(this.logger, error, "listing files", `in [${directoryName}]`)
            return
        }
    }

    // Returns a list of files with a specific extension in a directory
    listFilesByExtenstionInDirectory(directoryName: string, fileExtenstion: FileExtenstion): string[] | undefined {
        const files = this.listFilesInDirectory(directoryName)
        if (!files || files.length == 0) return
        // Filter results by extension
        else return files.filter(file => file.toLowerCase().endsWith(`.${fileExtenstion}`))
    }

    // Returns a list of CSV files in a directory
    listCsvFilesInDirectory(directoryName: string): string[] | undefined {
        return this.listFilesByExtenstionInDirectory(directoryName, FileExtenstion.CSV)
    }

    // Returns a list of CSV files matching a specific RegEx in a directory
    filterCsvFilesByRegExInDirectory(directoryName: string, regex: string): string[] | undefined {
        const files = this.listCsvFilesInDirectory(directoryName)
        if (!files || files.length == 0) return
        // Filter results by extension
        else return files.filter(file => file.toLowerCase().match(regex))
    }

    // Read CSV file to String
    readCsvFileToString(directoryName: string, fileName: string): string | undefined {
        try {
            return fs.readFileSync(path.join(directoryName, fileName), 'utf8')
        } catch (error) {
            logSrv.logStandardFsError(this.logger, error, "reading CSV file", `[${path.join(directoryName, fileName)}]`)
            return
        }
    }

    readAsString(value: string, quoted: boolean): string {
        return value
    }

    // Read CSV file into Object
    readCsvFileToObject(directoryName: string, fileName: string): any[] | undefined {
        const csv = this.readCsvFileToString(directoryName, fileName)
        if (!csv) return
        return csv2json(csv, { delimiter: ",", header: true, parseValue: this.readAsString })
    }

    // Specific Write function to CSV file
    writeObjectToCsvFile(directoryName: string, fileName: string, objectJson: any): boolean {
        const csv = json2csv(objectJson, { delimiter: ",", header: true })
        // Write CSV to File
        const writeFileOptions: fs.WriteFileOptions = {
            encoding: 'utf8'
        }
        try {
            fs.writeFileSync(path.join(directoryName, fileName), csv, writeFileOptions)
            return true
        } catch (error) {
            logSrv.logStandardFsError(this.logger, error, "writing object to file")
            return false
        }
    }

    // Master write object calls different specific write functions based on required output extenstion
    writeObjectToFile(directoryName: string, fileName: string, fileExtenstion: FileExtenstion, objectJson: any): boolean {
        if (fileExtenstion == FileExtenstion.CSV) return this.writeObjectToCsvFile(directoryName, `${fileName}.${fileExtenstion}`, objectJson)
        this.logger.error(`No write to file logic exists for File Extension: [${fileExtenstion}]`)
        return false
    }
}

