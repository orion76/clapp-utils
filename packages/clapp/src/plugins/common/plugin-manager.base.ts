import { IPlugin, PluginManagerBase as OrionPluginManagerBase } from '@orion76/plugin';

export interface ICommandPluginManager<P extends IPlugin> {
  getDefinition(id: string): Promise<P['definition']>;
  getDefinitions(): Promise<P['definition'][]>;
  getInstance(id: string): Promise<P>;
}

export abstract class CommandPluginManagerBase<P extends IPlugin>
  extends OrionPluginManagerBase<P>
  implements ICommandPluginManager<P>
{


  abstract getDefinition(id: string): Promise<P['definition']>;
  abstract getDefinitions(): Promise<P['definition'][]>;
  abstract getInstance(id: string): Promise<P>;


}
