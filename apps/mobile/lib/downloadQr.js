import { Alert, Image, PermissionsAndroid, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';

// Android 13+ (API 33+) replaced READ_EXTERNAL_STORAGE with the scoped
// READ_MEDIA_IMAGES permission; below API 29, saving new files also needs
// WRITE_EXTERNAL_STORAGE (declared in AndroidManifest.xml, maxSdkVersion=28).
// API 29-32 needs neither for app-created content thanks to scoped storage,
// but requesting READ_EXTERNAL_STORAGE there is harmless.
async function hasGallerySavePermission() {
  if (Platform.OS !== 'android') return true;

  const permission =
    Platform.Version >= 33
      ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
      : Platform.Version >= 29
      ? null
      : PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
  if (!permission) return true;

  if (await PermissionsAndroid.check(permission)) return true;
  const result = await PermissionsAndroid.request(permission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

// Downloads a bundled QR image (via require(...)) to the device's photo
// gallery. Bundled JS assets aren't real files on disk — in this Metro dev
// build, Image.resolveAssetSource(...).uri is an http URL served by the dev
// server, so it's fetched to a local cache file first, then handed to
// CameraRoll.save (which only accepts local file:// URIs). In a release
// build the resolved URI is a packaged drawable resource instead of an http
// URL — this path hasn't been verified there yet.
export async function downloadQr(source, filename, t) {
  try {
    if (!(await hasGallerySavePermission())) {
      Alert.alert(t('download'), t('galleryPermissionDenied'));
      return;
    }

    const { uri } = Image.resolveAssetSource(source);
    const localPath = `${RNFS.CachesDirectoryPath}/${filename}`;
    await RNFS.downloadFile({ fromUrl: uri, toFile: localPath }).promise;
    await CameraRoll.save(`file://${localPath}`, { type: 'photo' });

    Alert.alert(t('download'), t('qrSavedToGallery'));
  } catch (err) {
    Alert.alert(t('download'), err.message || t('downloadFailed'));
  }
}
