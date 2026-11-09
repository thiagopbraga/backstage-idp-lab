export interface Config {
  /** Configuration for the code-quality backend plugin. */
  codeQuality?: {
    /**
     * auto (default): use the live API for each provider that has a token and
     * mock data for the others. mock: always mock. live: always call the APIs
     * (GitHub public repos work without a token, subject to rate limits).
     */
    mode?: 'auto' | 'mock' | 'live';
    /** How long a report section is cached, in seconds. Default 300. */
    cacheTtlSeconds?: number;
    sonarqube?: {
      /** SonarQube Server or SonarCloud base URL. Default https://sonarcloud.io */
      baseUrl?: string;
      /**
       * User or project analysis token (read-only "Browse" permission is enough).
       * @visibility secret
       */
      token?: string;
    };
    github?: {
      /** REST API base URL. Default https://api.github.com (GHES: https://ghe/api/v3) */
      apiBaseUrl?: string;
      /**
       * Overrides the token from integrations.github for this plugin only.
       * @visibility secret
       */
      token?: string;
    };
  };
}
