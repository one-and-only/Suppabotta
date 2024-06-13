import { writeFileSync } from "fs";
import chalk from "chalk";

export default class Logger {
    static _logToFile(message) {
        if (process.env.LOG_FILE_PATH) {
            writeFileSync(process.env.LOG_FILE_PATH, `${message}\n`, { flag: 'a' });
        }
    }

    /**
     * @param {string} type 
     * @param {string} connector 
     * @param {string} action 
     * @param {string} message 
     * @param {string} color 
     * @param {boolean} goingToBrowser 
     * @param {IORedis} redisConnection 
     * @param {string} jobId 
     */
    static async _processMessage(type, connector, action, message, color, goingToBrowser, redisConnection, jobId) {
        let processedMessage = `[${type}] ${connector}|${action}: ${message}`;

        if (!goingToBrowser)
            processedMessage = chalk[color](processedMessage);

        processedMessage = `${new Date().toISOString()} ${processedMessage}`;

        if (goingToBrowser) {
            const currentLogs = JSON.parse(await redisConnection.get(`logs_${jobId}`));

            currentLogs.push(processedMessage);
            redisConnection.set(`logs_${jobId}`, JSON.stringify(currentLogs));
        } else {
            console.log(processedMessage);
            this._logToFile(processedMessage);
        }
    }

    static async success(connector, action, message, goingToBrowser = false, redisConnection=null, jobId="") {
        this._processMessage("SUCCESS", connector, action, message, "greenBright", goingToBrowser, redisConnection, jobId);
    }

    static async info(connector, action, message, goingToBrowser = false, redisConnection=null, jobId="") {
        this._processMessage("INFO", connector, action, message, "blueBright", goingToBrowser, redisConnection, jobId);
    }

    static async warning(connector, action, message, goingToBrowser = false, redisConnection=null, jobId="") {
        this._processMessage("WARNING", connector, action, message, "yellowBright", goingToBrowser, redisConnection, jobId);
    }

    static async error(connector, action, message, goingToBrowser = false, redisConnection=null, jobId="") {
        this._processMessage("ERROR", connector, action, message, "redBright", goingToBrowser, redisConnection, jobId);
    }
}