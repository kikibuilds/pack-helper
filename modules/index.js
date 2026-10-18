// 内置模块清单（公开版）。自己的私有模块放在 modules-private/index.js，见 docs/MODULES.md。
import { registerModule } from '../core/registry.js';
import shipping from './shipping/module.js';
import remote from './remote/module.js';
import monitor from './monitor/module.js';

for (const m of [shipping, remote, monitor]) registerModule(m);
