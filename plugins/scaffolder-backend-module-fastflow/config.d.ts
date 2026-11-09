export interface Config {
  fastflow?: {
    governance?: {
      naming?: {
        /** Default 3 */
        minLength?: number;
        /** Default 40 */
        maxLength?: number;
        /** Default ['-api', '-service', '-worker', '-bff', '-web'] */
        allowedSuffixes?: string[];
      };
    };
    scaffolder?: {
      /** Where fastflow:publish:local writes generated projects. Default <tmpdir>/fastflow-golden-paths */
      localOutputDir?: string;
    };
  };
}
