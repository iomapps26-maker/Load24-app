import { Alert, PermissionsAndroid, Platform } from 'react-native';
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

// Downloads a QR image to the device's photo gallery.
//
// `assetPath` is a path *relative to android/app/src/main/assets*, not a
// require(...) — bundled JS image assets (Image.resolveAssetSource) resolve
// very differently between debug and release: in a Metro dev build the uri
// is an http URL the dev server serves, but in a release build (no Metro
// attached) it resolves to a bare Android drawable-resource identifier with
// no scheme at all, which RNFS.downloadFile can't fetch — that mismatch is
// exactly why this previously failed for release/production builds while
// looking fine in dev. Reading straight out of the native assets/ folder
// (bundled verbatim in both debug and release APKs) sidesteps all of that.
export async function downloadQr(assetPath, filename, t) {
  try {
    if (!(await hasGallerySavePermission())) {
      Alert.alert(t('download'), t('galleryPermissionDenied'));
      return;
    }

    const base64 = await RNFS.readFileAssets(assetPath, 'base64');
    const localPath = `${RNFS.CachesDirectoryPath}/${filename}`;
    await RNFS.writeFile(localPath, base64, 'base64');
    await CameraRoll.save(`file://${localPath}`, { type: 'photo' });

    Alert.alert(t('download'), t('qrSavedToGallery'));
  } catch (err) {
    Alert.alert(t('download'), err.message || t('downloadFailed'));
  }
}
