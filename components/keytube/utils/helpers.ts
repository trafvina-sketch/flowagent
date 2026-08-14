export const isValidYoutubeUrl = (url: string): boolean => {
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
  return youtubeRegex.test(url);
};

export const extractVideoId = (url: string): string | null => {
  if (!isValidYoutubeUrl(url)) return null;
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
};

export const imageUrlToBase64 = async (url: string): Promise<string> => {
  // Due to CORS policy, we cannot directly fetch images from youtube.
  // We use a public CORS proxy specialized for images for better stability.
  // The images.weserv.nl proxy requires the URL without the protocol.
  const urlWithoutProtocol = url.replace(/^(https?:\/\/)?/, '');
  const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(urlWithoutProtocol)}`;
  
  try {
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image via proxy: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          // The result is a Data URL: "data:image/jpeg;base64,...."
          // We need to extract just the Base64 part.
          const base64String = reader.result.split(',')[1];
          if (base64String) {
            resolve(base64String);
          } else {
            reject(new Error('Failed to extract base64 string from Data URL.'));
          }
        } else {
          reject(new Error('Failed to read blob as a Data URL.'));
        }
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("Error fetching or converting image:", error);
    throw new Error("Không thể tải hình ảnh thumbnail do chính sách CORS. Vui lòng thử lại sau.");
  }
};

/**
 * Format timestamps or clean text strings
 */
export const cleanBrackets = (text: string): string => {
  return text.replace(/^\[|\]$/g, '').trim();
};
