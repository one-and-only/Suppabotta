import { writeFileSync } from "fs";
import chalk from "chalk";

export default class Logger {
    static _logToFile(message) {
        if (process.env.LOG_FILE_PATH) {
            writeFileSync(process.env.LOG_FILE_PATH, message + "\n", { flag: 'a' });
        }
    }

    static _composeMessage(type, connector, action, message, color) {
        const colored = chalk[color](`[${type}] ${connector}|${action}: ${message}`);
        return `${new Date().toISOString()} ${colored}`;
    }

    static _processMessage(message) {
        console.log(message);
        this._logToFile(message);
    }

    static success(connector, action, message) {
        this._processMessage(this._composeMessage("SUCCESS", connector, action, message, "greenBright"));
    }

    static info(connector, action, message) {
        this._processMessage(this._composeMessage("INFO", connector, action, message, "blueBright"));
    }

    static warning(connector, action, message) {
        this._processMessage(this._composeMessage("WARNING", connector, action, message, "yellowBright"));
    }

    static error(connector, action, message) {
        this._processMessage(this._composeMessage("ERROR", connector, action, message, message, "redBright"));
    }
}