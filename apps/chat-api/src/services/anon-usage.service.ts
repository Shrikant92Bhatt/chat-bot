/**
 * Tracks free-trial message usage for unauthenticated visitors, keyed by IP.
 * In-memory (matches UserRegistryService) - resets on redeploy/restart, which
 * is acceptable for a soft anti-abuse limit rather than a hard quota.
 */
const FREE_MESSAGE_LIMIT = 1;

export class AnonUsageService {
  private static usageByIp = new Map<string, number>();

  public static hasFreeMessagesRemaining(ip: string): boolean {
    return (this.usageByIp.get(ip) || 0) < FREE_MESSAGE_LIMIT;
  }

  public static recordUsage(ip: string): void {
    this.usageByIp.set(ip, (this.usageByIp.get(ip) || 0) + 1);
  }
}
