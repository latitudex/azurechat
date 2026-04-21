import { proxy, useSnapshot } from "valtio";

class InputImageState {
  public previewImages: string[] = [];
  public base64Images: string[] = [];

  /** Back-compat: returns first preview image or empty string */
  get previewImage(): string {
    return this.previewImages[0] || "";
  }

  /** Back-compat: returns first base64 image or empty string */
  get base64Image(): string {
    return this.base64Images[0] || "";
  }

  get PreViewImage() {
    return this.previewImage;
  }

  /** Add a new image without removing existing ones */
  public AddImage(image: string) {
    this.base64Images.push(image);
    this.previewImages.push(image);
  }

  /** Back-compat: overwrites all images with a single one */
  public UpdateBase64Image(image: Base64URLString) {
    this.base64Images = [image];
    this.previewImages = [image];
  }

  /** Remove a specific image by index */
  public RemoveImage(index: number) {
    this.base64Images.splice(index, 1);
    this.previewImages.splice(index, 1);
  }

  public Reset() {
    this.previewImages = [];
    this.base64Images = [];
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
        } else {
          reject("Error converting file to base64");
        }
      };
    });
  }

  public async OnFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      const base64 = await this.fileToBase64(file);
      this.AddImage(base64);
    }
  }
}

export const InputImageStore = proxy(new InputImageState());

export const useInputImage = () => {
  return useSnapshot(InputImageStore, { sync: true });
};
