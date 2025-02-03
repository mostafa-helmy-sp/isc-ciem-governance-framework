import pino, { Logger } from "pino"

export function getLogger(logLevel?: string): Logger {
    // Initialize standard logger object
    const logger = pino({
        formatters: {
            level(label, number) {
                return { level: label }
            }
        },
        timestamp: pino.stdTimeFunctions.isoTime,
    })
    if (logLevel) logger.level = logLevel
    return logger
}

export function logStandardApiError(logger: Logger, error: unknown, actionName: string, customMessage?: string, object?: any): string {
    let debugMessage = `Failed ${actionName} API request`
    let errorMessage = (customMessage ? `Error ${customMessage} using ${actionName} API` : debugMessage) + `: [${error instanceof Error ? error.message : error}]`
    // Strip the authorization header from the logs
    if (object.headers?.Authorization) {
        object.headers.Authorization = "xxx"
    }
    return logStandardError(logger, error, errorMessage, debugMessage, object)
}

export function logStandardFsError(logger: Logger, error: unknown, actionName: string, customMessage?: string): string {
    let debugMessage = `Error ${actionName}`
    let errorMessage = `${debugMessage} ${customMessage ? ` ${customMessage} ` : ""}: [${error instanceof Error ? error.message : error}]`
    return logStandardError(logger, error, errorMessage, debugMessage)
}

function logStandardError(logger: Logger, error: unknown, errorMessage: string, debugMessage: string, object?: any): string {
    if (object) {
        logger.error(object, errorMessage)
    } else {
        logger.error(errorMessage)
    }
    logger.debug(error, debugMessage)
    return errorMessage
}