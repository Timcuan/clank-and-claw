module.exports = {
    apps: [{
        name: "clanker-bot",
        script: "./telegram-bot.js",
        watch: false,
        env: {
            NODE_ENV: "production",
        },
        // Resource Management
        max_memory_restart: "400M", // Restart if leak occurs

        // Resilience
        exp_backoff_restart_delay: 1000, // Progressive restart delay
        restart_delay: 5000,
        max_restarts: 1000,
        min_uptime: "1m",
        // Exit code 2 = fatal configuration issue (invalid/missing token, duplicate instance)
        stop_exit_codes: [2],

        // Logging
        error_file: "./logs/err.log",
        out_file: "./logs/out.log",
        log_date_format: "YYYY-MM-DD HH:mm:ss Z",
        time: true
    }]
};
