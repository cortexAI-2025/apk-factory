import { Framework } from '../detection/types';
import { BuildEngine } from './types';
import { androidNativeEngine } from './android-native.engine';
import { reactNativeCliEngine } from './react-native-cli.engine';

export function getEngine(framework: Framework | undefined): BuildEngine {
  switch (framework) {
    case undefined:
    case 'ANDROID_NATIVE':
      return androidNativeEngine;
    case 'REACT_NATIVE_CLI':
      return reactNativeCliEngine;
    default:
      throw new Error(`No build engine implemented for framework: ${framework}`);
  }
}
