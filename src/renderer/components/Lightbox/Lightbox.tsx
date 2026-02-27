import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useI18n } from '../../i18n';
import './Lightbox.css';

interface LightboxImage {
  src: string;
  alt?: string;
  caption?: string;
}

interface LightboxProps {
  images: LightboxImage[];
  initialIndex?: number;
  isOpen: boolean;
  onClose: () => void;
}

export const Lightbox: React.FC<LightboxProps> = ({
  images,
  initialIndex = 0,
  isOpen,
  onClose,
}) => {
  const { t: tr } = useI18n();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isZoomed, setIsZoomed] = useState(false);

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;
    
    switch (e.key) {
      case 'Escape':
        onClose();
        break;
      case 'ArrowLeft':
        setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
        break;
      case 'ArrowRight':
        setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
        break;
    }
  }, [isOpen, images.length, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!isOpen || images.length === 0) {
    return null;
  }

  const currentImage = images[currentIndex];
  const hasMultiple = images.length > 1;

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const toggleZoom = () => {
    setIsZoomed(!isZoomed);
  };

  return (
    <div className="lightbox-overlay" onClick={handleBackdropClick}>
      <div className="lightbox-container">
        {/* Close button */}
        <button className="lightbox-close" onClick={onClose} title={tr('lightbox.close')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>

        {/* Navigation arrows */}
        {hasMultiple && (
          <>
            <button className="lightbox-nav lightbox-prev" onClick={handlePrev} title={tr('lightbox.previous')}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
              </svg>
            </button>
            <button className="lightbox-nav lightbox-next" onClick={handleNext} title={tr('lightbox.next')}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
              </svg>
            </button>
          </>
        )}

        {/* Main image */}
        <div className={`lightbox-image-container ${isZoomed ? 'zoomed' : ''}`}>
          <img
            src={currentImage.src}
            alt={currentImage.alt || ''}
            onClick={toggleZoom}
            className="lightbox-image"
          />
        </div>

        {/* Caption and counter */}
        <div className="lightbox-footer">
          {currentImage.caption && (
            <p className="lightbox-caption">{currentImage.caption}</p>
          )}
          {hasMultiple && (
            <div className="lightbox-counter">
              {currentIndex + 1} / {images.length}
            </div>
          )}
        </div>

        {/* Thumbnail strip for galleries */}
        {hasMultiple && images.length <= 10 && (
          <div className="lightbox-thumbnails">
            {images.map((image, index) => (
              <button
                key={index}
                className={`lightbox-thumbnail ${index === currentIndex ? 'active' : ''}`}
                onClick={() => setCurrentIndex(index)}
              >
                <img src={image.src} alt={image.alt || ''} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Hook to extract images from markdown content
export function useMarkdownImages(content: string): LightboxImage[] {
  return useMemo(() => {
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const matches: LightboxImage[] = [];
    let match;

    while ((match = imageRegex.exec(content)) !== null) {
      matches.push({
        alt: match[1] || undefined,
        src: match[2],
      });
    }

    return matches;
  }, [content]);
}

// Component to render images with lightbox support
interface ImageGalleryProps {
  images: LightboxImage[];
}

export const ImageGallery: React.FC<ImageGalleryProps> = ({ images }) => {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (images.length === 0) {
    return null;
  }

  const openLightbox = (index: number) => {
    setSelectedIndex(index);
    setLightboxOpen(true);
  };

  if (images.length === 1) {
    return (
      <>
        <div className="single-image" onClick={() => openLightbox(0)}>
          <img src={images[0].src} alt={images[0].alt || ''} />
          {images[0].caption && <p className="image-caption">{images[0].caption}</p>}
        </div>
        <Lightbox
          images={images}
          initialIndex={selectedIndex}
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      </>
    );
  }

  return (
    <>
      <div className={`image-gallery gallery-${Math.min(images.length, 4)}`}>
        {images.map((image, index) => (
          <div 
            key={index} 
            className="gallery-item"
            onClick={() => openLightbox(index)}
          >
            <img src={image.src} alt={image.alt || ''} />
          </div>
        ))}
      </div>
      <Lightbox
        images={images}
        initialIndex={selectedIndex}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </>
  );
};

export default Lightbox;
