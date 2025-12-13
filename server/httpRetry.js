export async function withRetry(fn, { retries = 3, base = 300 } = {}) {
    let lastError;
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e;
            const status = e.response?.status;
            // Don't retry 400 headers, 401 auth, 403 forbidden
            if (status && (status < 500 && status !== 429)) {
                throw e;
            }
            // Wait with jitter
            const delay = base * (2 ** i) + Math.random() * 100;
            console.warn(`[Retry] Attempt ${i + 1}/${retries} failed. Retrying in ${delay.toFixed(0)}ms. Error: ${e.message}`);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw lastError;
}
