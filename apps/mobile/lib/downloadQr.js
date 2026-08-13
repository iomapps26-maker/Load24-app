import { Alert, Image, PermissionsAndroid, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';

// CameraRoll.save() writes through MediaStore's scoped-storage insert() on
// API 29+, which needs no permission at all — only the pre-Q direct-file-write
// fallback (API < 29) needs WRITE_EXTERNAL_STORAGE (declared in
// AndroidManifest.xml, maxSdkVersion=28). We deliberately do NOT request
// READ_MEDIA_IMAGES/READ_EXTERNAL_STORAGE: this flow only ever writes a
// bundled QR image to the gallery, never reads the user's existing photos,
// and Google Play's photo/video permissions policy flags that broad a
// permission as unjustified for a write-only use case like this one.
async function hasGallerySavePermission() {
  if (Platform.OS !== 'android' || Platform.Version >= 29) return true;

  const permission = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
  if (await PermissionsAndroid.check(permission)) return true;
  const result = await PermissionsAndroid.request(permission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

// Downloads a bundled QR image (via require(...)) to the device's photo
// gallery. Bundled JS assets aren't real files on disk — in a Metro dev
// build, Image.resolveAssetSource(...).uri is an http URL served by the dev
// server, so it's fetched to a local cache file first, then handed to
// CameraRoll.save (which only accepts local file:// URIs). In a release
// build the resolved URI is a packaged drawable resource instead; confirmed
// working on-device (Pixel_3a_API_34, debug build) after a Metro cache
// reset — the release-signed build boots cleanly too.
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
