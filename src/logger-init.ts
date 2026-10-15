
import {ILoggerConfig,LoggerCollection,UConsoleLevels} from '@orion76/logger'

type ULoggerNames = 'clapp_utils';
const clappConfig: ILoggerConfig<UConsoleLevels>[] = [
  {

    enabled: false,
    levels: ['log', 'debug', 'error', 'info', 'warn'],
    enabledLevels: ['log', 'debug', 'error', 'info', 'warn'],
  },
];
const loggerCollections = new LoggerCollection<ULoggerNames, UConsoleLevels>();

export function getLogger(name: ULoggerNames) {
  return loggerCollections.get(name);
}
