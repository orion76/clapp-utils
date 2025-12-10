import { IPluginDiscoveryConfig } from '../../../types';
import { CommandPluginDiscoveryBase } from '../../common/plugin-discovery/plugin-discovery.base';
import { PLUGIN_CONTEXT_TYPE } from '../plugin';
import { IPluginContextDefinition } from '../types';



/**
 * Plugin discovery for commands
 * Loads command configurations from files and converts them to plugin definitions
 */
export class PluginDiscovery extends CommandPluginDiscoveryBase<IPluginContextDefinition> {
  type: string = PLUGIN_CONTEXT_TYPE;
  constructor(
    protected projects: string[],
    protected config: IPluginDiscoveryConfig
  ) {
    super();
  }
}
