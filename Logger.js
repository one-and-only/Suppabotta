import { writeFileSync } from "fs";
import chalk from "chalk";

export default class Logger {
    static _logToFile(message) {
        if (process.env.LOG_FILE_PATH) {
            writeFileSync(process.env.LOG_FILE_PATH, `${message}\n`, { flag: 'a' });
        }
    }

    static _processMessage(type, connector, action, message, color, goingToBrowser) {
        let processedMessage = `[${type}] ${connector}|${action}: ${message}`;

        if (!goingToBrowser)
            processedMessage = chalk[color](processedMessage);

        processedMessage = `${new Date().toISOString()} ${processedMessage}`;

        if (goingToBrowser) {
            console.log(processedMessage); // TODO replace this with the custom client-server logging implementation
        } else {
            console.log(processedMessage);
            this._logToFile(processedMessage);
        }
    }

    static success(connector, action, message, goingToBrowser = false) {
        this._processMessage("SUCCESS", connector, action, message, "greenBright", goingToBrowser);
    }

    static info(connector, action, message, goingToBrowser = false) {
        this._processMessage("INFO", connector, action, message, "blueBright", goingToBrowser);
    }

    static warning(connector, action, message, goingToBrowser = false) {
        this._processMessage("WARNING", connector, action, message, "yellowBright", goingToBrowser);
    }

    static error(connector, action, message, goingToBrowser = false) {
        this._processMessage("ERROR", connector, action, message, "redBright", goingToBrowser);
    }
}