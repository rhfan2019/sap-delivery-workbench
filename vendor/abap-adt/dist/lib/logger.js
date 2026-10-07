export function createLogger(name) {
    const log = (level, message) => {
        if (process.env.SAP_LOG_LEVEL === "debug")
            process.stderr.write(JSON.stringify({ level, service: name, message }) + "\n");
    };
    return {
        error: (m, _) => log("error", m),
        warn: (m, _) => log("warn", m),
        info: (m, _) => log("info", m),
        debug: (m, _) => log("debug", m),
    };
}
