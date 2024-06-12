import { writeFileSync } from "fs";
import chalk from "chalk";

export default class Logger {
    static _logToFile(message) {
        if (process.env.LOG_FILE_PATH) {
            writeFileSync(process.env.LOG_FILE_PATH, `${message}\n`, { flag: 'a' });
        }
    }

    static _composeMessage(type, connector, action, message, color, goingToBrowser) {
        let processedMessage = `[${type}] ${connector}|${action}: ${message}`;
        if (!goingToBrowser)
            processedMessage = chalk[color](processedMessage);
        return `${new Date().toISOString()} ${processedMessage}`;
    }

    static _processMessage(message, goingToBrowser) {
        if (goingToBrowser) {
            console.log(message); // TODO replace this with the custom client-server logging implementation
        } else {
            console.log(message);
            this._logToFile(message);
        }
    }

    static success(connector, action, message, goingToBrowser = false) {
        this._processMessage(this._composeMessage("SUCCESS", connector, action, message, "greenBright", goingToBrowser), goingToBrowser);
    }

    static info(connector, action, message, goingToBrowser = false) {
        this._processMessage(this._composeMessage("INFO", connector, action, message, "blueBright", goingToBrowser), goingToBrowser);
    }

    static warning(connector, action, message, goingToBrowser = false) {
        this._processMessage(this._composeMessage("WARNING", connector, action, message, "yellowBright", goingToBrowser), goingToBrowser);
    }

    static error(connector, action, message, goingToBrowser = false) {
        this._processMessage(this._composeMessage("ERROR", connector, action, message, "redBright", goingToBrowser), goingToBrowser);
    }
}