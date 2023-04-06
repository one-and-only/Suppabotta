import { writeFileSync } from "fs";
import chalk from "chalk";

export default class Logger {
    static _logToFile(message) {
        if (process.env.LOG_FILE_PATH) {
            writeFileSync(process.env.LOG_FILE_PATH, message + "\n", { flag: 'a' });
        }
    }

    static _composeMessage(type, connector, action, message, color, socketBroadcaster) {
        let processedMessage = `[${type}] ${connector}|${action}: ${message}`;
        if (!socketBroadcaster)
            processedMessage = chalk[color](processedMessage);
        return `${new Date().toISOString()} ${processedMessage}`;
    }

    static _processMessage(message, socketBroadcaster) {
        if (socketBroadcaster) {
            socketBroadcaster.emit("message", message);
        } else {
            console.log(message);
            this._logToFile(message);
        }
    }

    static success(connector, action, message, socketBroadcaster = null) {
        this._processMessage(this._composeMessage("SUCCESS", connector, action, message, "greenBright", socketBroadcaster), socketBroadcaster);
    }

    static info(connector, action, message, socketBroadcaster = null) {
        this._processMessage(this._composeMessage("INFO", connector, action, message, "blueBright", socketBroadcaster), socketBroadcaster);
    }

    static warning(connector, action, message, socketBroadcaster = null) {
        this._processMessage(this._composeMessage("WARNING", connector, action, message, "yellowBright", socketBroadcaster), socketBroadcaster);
    }

    static error(connector, action, message, socketBroadcaster = null) {
        this._processMessage(this._composeMessage("ERROR", connector, action, message, "redBright", socketBroadcaster), socketBroadcaster);
    }
}