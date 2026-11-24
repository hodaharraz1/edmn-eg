import 'package:edmn_customer/src/common/file_pick.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_test/flutter_test.dart';

final class _UnreadableFile extends PlatformFile {
  @override
  String get name => 'test.png';
  @override
  Never get xFile => throw StateError('read failed');
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Picker extends FilePickerPlatform {
  int cleanups = 0;
  List<String>? extensions;
  @override
  Future<PlatformFile?> pickFile({
    String? dialogTitle, String? initialDirectory, FileType type = FileType.any,
    List<String>? allowedExtensions, Function(FilePickerStatus)? onFileLoading, int compressionQuality = 0,
    AndroidOptions androidOptions = const AndroidOptions(), DarwinOptions darwinOptions = const DarwinOptions(),
    WindowsOptions windowsOptions = const WindowsOptions(), LinuxOptions linuxOptions = const LinuxOptions(),
    WebOptions webOptions = const WebOptions(),
  }) async {
    extensions = allowedExtensions;
    return _UnreadableFile();
  }
  @override
  Future<void> clearTemporaryFiles() async { cleanups++; }
}

void main() {
  test('temporary picker files are cleared even when reading fails', () async {
    final original = FilePickerPlatform.instance;
    final picker = _Picker();
    FilePickerPlatform.instance = picker;
    addTearDown(() => FilePickerPlatform.instance = original);
    await expectLater(PlatformFilePicker().pick(allowPdf: false), throwsStateError);
    expect(picker.cleanups, 1);
    expect(picker.extensions, ['jpg', 'jpeg', 'png', 'webp']);
  });
}
