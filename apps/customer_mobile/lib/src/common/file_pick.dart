import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A file chosen by the user (receipt, evidence, product photo). Bytes are validated again by the server.
class PickedFile {
  const PickedFile({required this.name, required this.bytes});
  final String name;
  final Uint8List bytes;
}

abstract class FilePickerService {
  /// Images (and PDF when [allowPdf]); null when cancelled.
  Future<PickedFile?> pick({bool allowPdf = true});
}

class PlatformFilePicker implements FilePickerService {
  @override
  Future<PickedFile?> pick({bool allowPdf = true}) async {
    final f = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', if (allowPdf) 'pdf']);
    if (f == null) return null;
    return PickedFile(name: f.name, bytes: await f.xFile.readAsBytes());
  }
}

final filePickerProvider = Provider<FilePickerService>((ref) => PlatformFilePicker());

/// Saving a private attachment is an explicit user action; it is never written to disk while merely viewing chat.
abstract class FileSaverService {
  Future<void> save(String name, Uint8List bytes);
}
class PlatformFileSaver implements FileSaverService {
  @override
  Future<void> save(String name, Uint8List bytes) async {
    await FilePicker.saveFile(fileName: name, bytes: bytes, mimeType: 'application/pdf');
  }
}
final fileSaverProvider = Provider<FileSaverService>((ref) => PlatformFileSaver());
