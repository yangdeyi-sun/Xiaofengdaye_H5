import { readFile } from 'node:fs/promises';

// nbind's prebuilt asm.js predates strict ESM: a generated temporary was accidentally
// undeclared. Keep it local to the module, without adding a global or editing node_modules.
export const canvasUiPlugins = [{
  name: 'strict-yoga-runtime',
  setup(build) {
    build.onLoad({ filter: /yoga-layout[\\/]build[\\/]Release[\\/]nbind\.js$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      return { contents: source.replace('function (Module, cb) {', 'function (Module, cb) { var _a;')
        .replace('Module["print"] = print;', 'Module["print"] = typeof print === "function" ? print : console.log.bind(console);'), loader: 'js' };
    });
  }
}];
