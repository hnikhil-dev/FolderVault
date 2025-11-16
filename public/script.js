// Smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Download button functionality
const downloadBtn = document.getElementById('downloadBtn');
const fileSizeElement = document.getElementById('fileSize');

// Get file size
async function getFileSize() {
    try {
        const response = await fetch('/FolderVault-win32-x64.zip', { method: 'HEAD' });
        if (response.ok) {
            const size = parseInt(response.headers.get('content-length') || '0');
            const sizeInMB = (size / (1024 * 1024)).toFixed(2);
            fileSizeElement.textContent = `File size: ${sizeInMB} MB`;
        } else {
            fileSizeElement.textContent = 'File size: Unknown';
        }
    } catch (error) {
        console.error('Error fetching file size:', error);
        fileSizeElement.textContent = 'File size: Unknown';
    }
}

// Download functionality - Force download using blob
downloadBtn.addEventListener('click', async function () {
    // Disable button and show loading state
    const originalText = downloadBtn.innerHTML;
    downloadBtn.innerHTML = `
        <svg class="w-6 h-6 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
        </svg>
        <span>Downloading...</span>
    `;
    downloadBtn.disabled = true;

    try {
        // Fetch the file as a blob
        const response = await fetch('/FolderVault-win32-x64.zip');

        if (!response.ok) {
            throw new Error('Failed to download file');
        }

        const blob = await response.blob();

        // Create a blob URL
        const blobUrl = window.URL.createObjectURL(blob);

        // Create a temporary anchor element to trigger download
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = 'FolderVault-win32-x64.zip';
        link.style.display = 'none';

        // Append to body, click, and remove
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up the blob URL after a short delay
        setTimeout(() => {
            window.URL.revokeObjectURL(blobUrl);
        }, 100);

        // Show success message briefly
        downloadBtn.innerHTML = `
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
            <span>Download Started!</span>
        `;

        // Reset button after 2 seconds
        setTimeout(() => {
            downloadBtn.innerHTML = originalText;
            downloadBtn.disabled = false;
        }, 2000);

    } catch (error) {
        console.error('Download error:', error);

        // Show error message
        downloadBtn.innerHTML = `
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
            <span>Download Failed</span>
        `;

        // Reset button after 3 seconds
        setTimeout(() => {
            downloadBtn.innerHTML = originalText;
            downloadBtn.disabled = false;
        }, 3000);
    }
});

// Get file size on page load
getFileSize();

// Add scroll effect to navigation
let lastScroll = 0;
const nav = document.querySelector('nav');

window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;

    if (currentScroll <= 0) {
        nav.classList.remove('glass-effect');
        nav.classList.add('glass-effect');
    }

    lastScroll = currentScroll;
});

// Intersection Observer for fade-in animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

// Observe all feature cards
document.querySelectorAll('.feature-card').forEach(card => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(card);
});

