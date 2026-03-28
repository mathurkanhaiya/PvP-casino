// Userbot removed — USDT auto-pay feature has been disabled.
export async function initUserbot(): Promise<void> {}
export function isUserbotReady(): boolean { return false; }
export async function sendUsdtPayout(): Promise<boolean> { return false; }
export async function initiateSetup(): Promise<string> { throw new Error("USDT feature removed"); }
export function provideOtp(): boolean { return false; }
export function isSetupInProgress(): boolean { return false; }
