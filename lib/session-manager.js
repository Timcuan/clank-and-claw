/**
 * 🧹 Session Manager v1.0
 * 
 * Handles user sessions with automatic cleanup for stale interactions.
 */

// Default configuration
const DEFAULT_FEES = {
    type: 'static',
    clankerFee: 100, // 1%
    pairedFee: 100   // 1%
};

class SessionManager {
    constructor(ttlMinutes = 15) {
        this.sessions = new Map();
        this.ttl = ttlMinutes * 60 * 1000;

        // Auto-cleanup every minute.
        // Use unref() so this interval doesn't keep the process alive if everything else stops.
        this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
        if (this.cleanupInterval.unref) this.cleanupInterval.unref();

        console.log(`⏱️  Session Manager initialized (TTL: ${ttlMinutes}m)`);
    }

    /**
     * Get existing session or create/refresh one
     */
    get(chatId) {
        const id = String(chatId);

        if (!this.sessions.has(id)) {
            return this.create(id);
        }

        const session = this.sessions.get(id);
        session.lastActive = Date.now(); // Refresh TTL
        return session;
    }

    /**
     * Check if session exists without creating
     */
    has(chatId) {
        return this.sessions.has(String(chatId));
    }

    /**
     * Create fresh session
     */
    create(chatId) {
        const id = String(chatId);

        const session = {
            id,
            state: 'idle',
            lastActive: Date.now(),
            createdAt: Date.now(),
            token: {
                name: null,
                symbol: null,
                image: null,
                description: null,
                fees: { ...DEFAULT_FEES },
                context: null,
                socials: {}, // Explicitly init empty socials
                spoofTo: null
            },
            pendingMessageId: null
        };

        this.sessions.set(id, session);
        return session;
    }

    /**
     * Reset session data but keep ID
     */
    reset(chatId) {
        const id = String(chatId);
        if (this.sessions.has(id)) {
            this.sessions.delete(id);
        }
        return this.create(id);
    }

    /**
     * Remove stale sessions
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;

        for (const [id, session] of this.sessions.entries()) {
            if (now - session.lastActive > this.ttl) {
                // Determine if session was important (non-idle)
                if (session.state !== 'idle') {
                    // Optional: could log abandoned sessions
                }
                this.sessions.delete(id);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            // console.log(`🧹 Cleaned ${cleaned} stale sessions`);
        }
    }

    /**
     * Get active session count
     */
    count() {
        return this.sessions.size;
    }
}

// Singleton instance
export const sessionManager = new SessionManager();
export const DEFAULT_SESSION_FEES = DEFAULT_FEES;
