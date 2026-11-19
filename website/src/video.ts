/**
 * The product video slot on the home page. While `PRODUCT_VIDEO` is null the page shows an
 * animated dot-matrix poster that says the video is coming. To publish the real video, put the
 * files in website/public/video/ and set this (see "Adding the product video" in website/README.md):
 *
 *   export const PRODUCT_VIDEO: ProductVideo | null = {
 *     src: "/video/dotdock-tour.mp4",
 *     poster: "/video/dotdock-tour-poster.webp",
 *     label: "A tour of the launcher, the dock and the notch",
 *   };
 */
export interface ProductVideo {
  /** Public URL of an MP4 (H.264) file. */
  readonly src: string;
  /** Public URL of the still frame shown before play. */
  readonly poster: string;
  /** Accessible description of what the video shows. */
  readonly label: string;
  /** Optional public URL of a WebVTT captions file. */
  readonly captions?: string;
}

export const PRODUCT_VIDEO: ProductVideo | null = null;
