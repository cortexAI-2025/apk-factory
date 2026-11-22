import { Framework } from '../detection/types';
import { BuildEngine } from './types';
import { androidNativeEngine } from './android-native.engine';
import { reactNativeCliEngine } from './react-native-cli.engine';
import { expoEngine } from './expo.engine';
import { capacitorEngine } from './capacitor.engine';
import { cordovaEngine } from './cordova.engine';
import { flutterEngine } from './flutter.engine';

export function getEngine(framework: Framework | undefined): BuildEngine {
  switch (framework) {
    case undefined:
    case 'ANDROID_NATIVE':
      return androidNativeEngine;
    case 'REACT_NATIVE_CLI':
      return reactNativeCliEngine;
    case 'EXPO_MANAGED':
    case 'EXPO_BARE':
      return expoEngine;
    case 'CAPACITOR':
      return capacitorEngine;
    case 'CORDOVA':
      return cordovaEngine;
    case 'FLUTTER':
      return flutterEngine;
    default:
      throw new Error(`No build engine implemented for framework: ${framework}`);
  }
}