import { writeFileSync } from "fs";

export default class Logger {
    static COLOR_GREEN = 92;
    static COLOR_BLUE = 94;
    static COLOR_YELLOW = 93;
    static COLOR_RED = 91;

    static _logToFile(message) {
        if (process.env.LOG_FILE_PATH) {
            writeFileSync(process.env.LOG_FILE_PATH, message + "\n", { flag: 'a' });
        }
    }

    static _composeMessage(type, connector, action, message, color) {
        return `${new Date().toISOString()} \x1b[${color}m[${type}] ${connector}|${action}: ${message}\x1b[0m`;
    }

    static _processMessage(message) {
        console.log(message);
        this._logToFile(message);
    }

    static success(connector, action, message) {
        this._processMessage(this._composeMessage("SUCCESS", connector, action, message, this.COLOR_GREEN));
    }

    static info(connector, action, message) {
        this._processMessage(this._composeMessage("INFO", connector, action, message, this.COLOR_BLUE));
    }

    static warning(connector, action, message) {
        this._processMessage(this._composeMessage("WARNING", connector, action, message, this.COLOR_YELLOW));
    }

    static error(connector, action, message) {
        this._processMessage(this._composeMessage("ERROR", connector, action, message, this.COLOR_RED));
    }
}