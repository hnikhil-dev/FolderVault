<div align="center">

# 🔐 FolderVault

**A modern, secure desktop application for encrypting and decrypting folders with military-grade cryptography**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Electron](https://img.shields.io/badge/Electron-25.0.0-47848F?logo=electron)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey?logo=windows)](https://www.microsoft.com/windows)
[![Security](https://img.shields.io/badge/Security-AES--256--GCM-green)](https://en.wikipedia.org/wiki/Galois/Counter_Mode)

*Streaming encryption • Zero-knowledge architecture • Professional-grade security*

[Features](#-features) • [Quick Start](#-quick-start) • [Documentation](#-documentation) • [Contributing](#-contributing)

---

</div>

## ✨ Features

<div align="center">

| 🔒 Security | ⚡ Performance | 🎨 User Experience |
|:---:|:---:|:---:|
| **AES-256-GCM** authenticated encryption | **Streaming I/O** - minimal RAM usage | **Drag & drop** folder selection |
| **scrypt KDF** (N=16384, r=8, p=1) | **Per-file progress** tracking | **Real-time ETA** and speed metrics |
| **Zero-knowledge** architecture | **Cooperative cancellation** | **Modern, intuitive UI** |
| **Secure-delete** option (multi-pass) | **Atomic operations** | **Live progress bars** |

</div>

### 🔐 Security Features

- ✅ **AES-256-GCM** - Industry-standard authenticated encryption
- ✅ **scrypt Key Derivation** - Memory-hard password hashing (N=16384, r=8, p=1)
- ✅ **Unique Salt & IV** - Each file gets its own salt and initialization vector
- ✅ **Authentication Tags** - Prevents tampering and ensures data integrity
- ✅ **Local Key Derivation** - Passwords never leave your machine
- ✅ **Secure Delete** - Multi-pass overwrite for original files (best-effort)

### ⚡ Performance Features

- 🚀 **Streaming Pipeline** - Handles large files without loading into memory
- 📊 **Real-time Progress** - Per-file and overall progress tracking
- ⏱️ **ETA Calculation** - Estimated time remaining with speed metrics
- 🛑 **Cancellation Support** - Stop operations safely at any time
- 💾 **Atomic Writes** - Decrypted files written to temp, then renamed atomically

### 🎨 User Experience

- 🖱️ **Drag & Drop** - Simply drag folders into the app
- 📁 **Folder Browser** - Native folder picker integration
- 📈 **Visual Progress** - Beautiful progress bars and status indicators
- 🔄 **Live Updates** - Real-time file processing status
- 📝 **Activity Log** - Detailed operation logs for troubleshooting

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 16+ and npm
- **Windows** 10/11 (currently optimized for Windows)
- **Git** (for cloning the repository)

### Installation & Running

<details>
<summary><b>📦 Option 1: Development Mode (Recommended for Contributors)</b></summary>

```powershell
# 1. Clone the repository
git clone https://github.com/yourname/folder-vault.git
cd folder-vault

# 2. Install dependencies
npm ci

# 3. Run the application
npm start
```

</details>

<details>
<summary><b>🎯 Option 2: Quick Test (3 Commands)</b></summary>

```powershell
# Install dependencies
npm ci

# Run the app
npm start

# Run automated tests
npm run test-harness
```

</details>

<details>
<summary><b>📦 Option 3: Build Portable Executable</b></summary>

```powershell
# Build a portable Windows executable
npm run build

# Output will be in ./dist/FolderVault-win32-x64/
# Just run FolderVault.exe - no installation needed!
```

> ⚠️ **Note**: Unsigned builds may trigger Windows SmartScreen warnings. This is expected for test builds.

</details>

---

## 📖 Documentation

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    FolderVault                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐         ┌──────────────┐              │
│  │  Renderer    │ ◄─────► │   Preload    │              │
│  │  (UI Layer)  │  IPC    │   (Bridge)   │              │
│  └──────────────┘         └──────────────┘              │
│         │                         │                     │
│         │                         ▼                     │
│         │              ┌──────────────┐                 │ 
│         └─────────────►│  Main Process│                 │
│                        │  (Crypto)    │                 │
│                        └──────────────┘                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### File Format Specification

Each encrypted file follows this structure:

```
┌──────────┬──────────┬──────────┬──────────────┬──────────────┐
│  MAGIC   │   SALT   │    IV    │  CIPHERTEXT  │  AUTH_TAG    │
│  (8 B)   │  (16 B)  │  (12 B)  │   (varies)   │   (16 B)     │
└──────────┴──────────┴──────────┴──────────────┴──────────────┘
```

- **MAGIC**: File identifier (`ELECTRON`)
- **SALT**: Random 16-byte salt for key derivation
- **IV**: 12-byte initialization vector for GCM mode
- **CIPHERTEXT**: Encrypted file content
- **AUTH_TAG**: 16-byte authentication tag (GCM)

### Project Structure

```
FolderVault/
├── main.js           # Electron main process (crypto operations)
├── preload.js        # Secure IPC bridge
├── renderer.js       # UI logic and event handling
├── renderer.css      # Application styles
├── index.html        # Application UI structure
├── test_harness.js   # Automated test suite
└── package.json      # Dependencies and scripts
```

<details>
<summary><b>🔧 Advanced Configuration</b></summary>

### Code Signing (For Production)

If you plan to distribute FolderVault publicly, code signing is recommended:

1. **Obtain a Certificate**: Get a code-signing certificate (PFX) from a CA (DigiCert, Sectigo, GlobalSign)

2. **Sign the Executable**:
```powershell
signtool sign /f C:\path\to\your.pfx /p YourPfxPassword `
  /tr http://timestamp.digicert.com /td SHA256 /fd SHA256 `
  C:\path\to\FolderVault.exe

# Verify the signature
signtool verify /pa /v C:\path\to\FolderVault.exe
```

3. **CI/CD Integration**: For automated signing, consider using:
   - GitHub Actions with secrets
   - Azure Key Vault
   - Managed signing services

</details>

---

## 🛡️ Security Considerations

<details>
<summary><b>⚠️ Important Security Notes</b></summary>

### Secure Delete Limitations

- **SSDs**: Secure-delete cannot guarantee erasure on SSDs due to wear-leveling
- **Network Filesystems**: May not support secure overwrite operations
- **Cloud Sync**: Files synced to OneDrive/Dropbox may retain versions
- **Best Practice**: Use secure-delete as an additional layer, not a guarantee

### Password Security

- ✅ Passwords are **never transmitted** over the network
- ✅ Keys are derived **locally** using scrypt
- ✅ Keys are **zeroed** from memory after use
- ⚠️ **Remember**: If you lose your password, files cannot be recovered

### Recommendations

1. **Strong Passwords**: Use long, complex passwords (16+ characters)
2. **Backup**: Keep encrypted backups in multiple locations
3. **Testing**: Test decryption before deleting originals
4. **Updates**: Keep the application updated for security patches

</details>

---

## 🧪 Testing

<details>
<summary><b>Run the Test Suite</b></summary>

The project includes a comprehensive test harness:

```powershell
npm run test-harness
```

**What it tests:**
- ✅ Encryption/decryption correctness
- ✅ Wrong password handling
- ✅ Secure delete functionality
- ✅ Cancellation support
- ✅ File format validation

</details>

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

<details>
<summary><b>Quick Contribution Guide</b></summary>

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Make** your changes
4. **Test** thoroughly (`npm run test-harness`)
5. **Commit** with clear messages
6. **Push** to your branch
7. **Open** a Pull Request

### Guidelines

- Keep PRs focused and small
- Include tests for new features
- For cryptographic changes, include rationale and tests
- Follow existing code style
- Update documentation as needed

</details>

---

## 🐛 Troubleshooting

<details>
<summary><b>Common Issues & Solutions</b></summary>

### Issue: `npm start` fails to launch Electron

**Solution:**
- Ensure Node.js 16+ is installed
- Try running from a local path (not OneDrive): `C:\dev\folder-vault`
- Clear `node_modules` and reinstall: `rm -r node_modules && npm ci`

### Issue: Windows SmartScreen warning

**Solution:**
- This is expected for unsigned builds
- For production, obtain a code-signing certificate
- Users can click "More info" → "Run anyway" for test builds

### Issue: Secure-delete not working

**Solution:**
- Secure-delete is best-effort and may not work on:
  - SSDs (wear-leveling)
  - Network filesystems
  - Cloud-synced folders
- Consider using "Keep originals" option for important files

### Issue: Permission errors

**Solution:**
- Run as administrator if needed
- Check folder permissions
- Ensure files aren't locked by other applications

</details>

---

## 📊 Performance Benchmarks

<details>
<summary><b>Click to view performance metrics</b></summary>

*Add your performance benchmarks here*

Example format:
- **Small files** (< 1 MB): ~50-100 files/sec
- **Medium files** (1-100 MB): ~10-50 MB/sec
- **Large files** (> 100 MB): Streaming, memory-efficient

</details>

---

## 📝 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2025 HNikhil

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🙏 Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- Uses Node.js [crypto](https://nodejs.org/api/crypto.html) module
- Inspired by the need for simple, secure file encryption

---

<div align="center">

### ⭐ Star this repo if you find it useful!

**Made with ❤️ by [HNikhil](https://github.com/hnikhil-dev)**

[Report Bug](https://github.com/hnikhil-dev/folder-vault/issues) • [Request Feature](https://github.com/hnikhil-dev/folder-vault/issues) • [Documentation](https://github.com/hnikhil-dev/folder-vault#-documentation)

</div>
