import { useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import { crackerCatalog } from "./crackerCatalog";
import "./CatalogMaker.css";

type ProductPhoto = {
  data: string;
  width: number;
  height: number;
};

type CatalogProduct = {
  id: number;
  image: string;
};

const categories = [...new Set(crackerCatalog.map((item) => item.category))];
const money = (price: string | null) => price ? `Rs. ${price}` : "Price not listed";
const catalogGroups = categories.map((category) => ({
  category,
  items: crackerCatalog.filter((item) => item.category === category),
}));
const productRowHeight = 3.75;
const categoryHeaderHeight = 4.8;
const catalogPages = (() => {
  let bestSplit = 1;
  let smallestPageDifference = Number.POSITIVE_INFINITY;
  for (let split = 1; split < catalogGroups.length; split += 1) {
    const firstPageHeight = catalogGroups.slice(0, split).reduce(
      (height, group) => height + categoryHeaderHeight + group.items.length * productRowHeight,
      0,
    );
    const secondPageHeight = catalogGroups.slice(split).reduce(
      (height, group) => height + categoryHeaderHeight + group.items.length * productRowHeight,
      0,
    );
    if (firstPageHeight > 249 || secondPageHeight > 249) continue;
    const pageDifference = Math.abs(firstPageHeight - secondPageHeight);
    if (pageDifference < smallestPageDifference) {
      bestSplit = split;
      smallestPageDifference = pageDifference;
    }
  }
  return [catalogGroups.slice(0, bestSplit), catalogGroups.slice(bestSplit)];
})();
const pdfPageCount = catalogPages.length;

function normalizeLabel(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

async function saveProjectPhoto(productId: number, photo: ProductPhoto, uploadToken: string): Promise<string> {
  const response = await fetch("/api/product-images", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(uploadToken ? { Authorization: `Bearer ${uploadToken}` } : {}),
    },
    body: JSON.stringify({ productId, data: photo.data }),
  });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Photo upload is unavailable on this server. Configure the production image API or run the Vite development server.");
  }
  const result = await response.json() as { image?: string; error?: string };
  if (!response.ok || !result.image) {
    throw new Error(result.error || "Photo could not be saved.");
  }
  return result.image;
}

async function removeProjectPhoto(productId: number, uploadToken: string) {
  const response = await fetch(`/api/product-images?productId=${productId}`, {
    method: "DELETE",
    headers: uploadToken ? { Authorization: `Bearer ${uploadToken}` } : {},
  });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Photo removal is unavailable on this server. Configure the production image API or run the Vite development server.");
  }
  const result = await response.json() as { error?: string };
  if (!response.ok) {
    throw new Error(result.error || "Saved project photo could not be removed.");
  }
}

async function preparePhoto(file: File): Promise<ProductPhoto> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file.");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error("Choose an image smaller than 15 MB.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Your browser could not prepare this image.");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return {
      data: canvas.toDataURL("image/jpeg", 0.62),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    bitmap.close();
  }
}

function downloadCatalog() {
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 7;
  const columnWidths = [14, 142, 40];
  const tableHeaderY = 31;
  const tableHeaderHeight = 6;
  const contentTop = tableHeaderY + tableHeaderHeight;
  const columnX = columnWidths.reduce<number[]>((positions, width) => {
    positions.push((positions.at(-1) ?? margin) + width);
    return positions;
  }, [margin]);

  const drawPageHeader = () => {
    pdf.setFillColor(54, 22, 91);
    pdf.rect(0, 0, pageWidth, 21, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(17);
    pdf.text("SLV CRACKERS", margin, 10);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.text("BRIGHT CELEBRATIONS | GREAT PRICES", margin, 16);
    pdf.setTextColor(47, 39, 57);
    pdf.setFontSize(8);
    pdf.text("PRODUCT PRICE LIST  |  PRICES IN INDIAN RUPEES (INR)", margin, 27);
    pdf.setFillColor(54, 22, 91);
    pdf.setDrawColor(54, 22, 91);
    pdf.rect(margin, tableHeaderY, pageWidth - margin * 2, tableHeaderHeight, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.text("NO.", columnX[0] + 2, tableHeaderY + 4.1);
    pdf.text("ITEM NAME", columnX[1] + 2, tableHeaderY + 4.1);
    pdf.text("PRICE", columnX[2] + 2, tableHeaderY + 4.1);
  };

  for (let page = 0; page < catalogPages.length; page += 1) {
    if (page > 0) pdf.addPage();
    drawPageHeader();
    let y = contentTop;
    for (const group of catalogPages[page]) {
      pdf.setFillColor(239, 232, 248);
      pdf.setDrawColor(220, 210, 232);
      pdf.setLineWidth(0.2);
      pdf.rect(margin, y, pageWidth - margin * 2, categoryHeaderHeight, "FD");
      pdf.setTextColor(64, 28, 96);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      pdf.text(group.category.toUpperCase(), margin + 2, y + 3.3);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(5.5);
      pdf.setTextColor(105, 83, 122);
      pdf.text(`${group.items.length} ITEMS`, pageWidth - margin - 2, y + 3.3, { align: "right" });
      y += categoryHeaderHeight;

      group.items.forEach((item, index) => {
        const rowHeight = productRowHeight;
        const rowBackground = index % 2 === 0 ? [255, 255, 255] : [250, 248, 252];
        const itemTextY = y + 2.6;
        pdf.setDrawColor(222, 218, 227);
        pdf.setLineWidth(0.12);
        columnWidths.forEach((width, column) => {
          pdf.setFillColor(rowBackground[0], rowBackground[1], rowBackground[2]);
          pdf.rect(columnX[column], y, width, rowHeight, "FD");
        });

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(6.5);
        pdf.setTextColor(120, 112, 128);
        pdf.text(String(item.id), columnX[0] + 2, itemTextY);
        pdf.setTextColor(42, 31, 57);
        pdf.text(item.name, columnX[1] + 2, itemTextY, { maxWidth: columnWidths[1] - 4 });
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(64, 28, 96);
        pdf.text(money(item.price), columnX[2] + 2, itemTextY, { maxWidth: columnWidths[2] - 4 });
        y += rowHeight;
      });
    }
  }

  const generatedPageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= generatedPageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(230, 222, 235);
    pdf.line(margin, pageHeight - 7, pageWidth - margin, pageHeight - 7);
    pdf.setTextColor(100, 90, 110);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6);
    pdf.text(`SLV CRACKERS  |  PAGE ${page} OF ${generatedPageCount}`, pageWidth - margin, pageHeight - 3, { align: "right" });
  }
  pdf.save("SLV_Crackers_Category_Price_List.pdf");
}

export default function CatalogMaker({
  products,
  storageError,
  onProductImageChange,
}: {
  products: CatalogProduct[];
  storageError: string;
  onProductImageChange: (productId: number, image: string | null) => void;
}) {
  const [photos, setPhotos] = useState<Record<number, ProductPhoto>>(() =>
    Object.fromEntries(
      products
        .filter((product) => product.image.startsWith("data:image/"))
        .map((product) => [product.id, { data: product.image, width: 1, height: 1 }]),
    ),
  );
  const [selectedCategory, setSelectedCategory] = useState("All categories");
  const [search, setSearch] = useState("");
  const [uploadToken, setUploadToken] = useState("");
  const [error, setError] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  const visibleItems = useMemo(() => crackerCatalog.filter((item) => {
    const matchesCategory = selectedCategory === "All categories" || item.category === selectedCategory;
    const matchesSearch = `${item.name} ${item.category}`.toLowerCase().includes(search.trim().toLowerCase());
    return matchesCategory && matchesSearch;
  }), [search, selectedCategory]);

  const publishedImages = useMemo(
    () => new Map(products.filter((product) => product.image.startsWith("/product-images/")).map((product) => [product.id, product.image])),
    [products],
  );

  useEffect(() => {
    let cancelled = false;
    const loadPublishedPhotos = async () => {
      for (const [itemId, imageUrl] of publishedImages) {
        try {
          const response = await fetch(imageUrl);
          if (!response.ok) throw new Error(`Could not load saved photo ${imageUrl}.`);
          const blob = await response.blob();
          const photo = await preparePhoto(new File([blob], `${itemId}.jpg`, { type: blob.type || "image/jpeg" }));
          if (!cancelled) setPhotos((current) => current[itemId] ? current : { ...current, [itemId]: photo });
        } catch (cause) {
          if (!cancelled) setError(cause instanceof Error ? cause.message : "A saved project photo could not be loaded.");
        }
      }
    };
    void loadPublishedPhotos();
    return () => { cancelled = true; };
  }, [publishedImages]);

  const attachPhoto = async (itemId: number, file: File) => {
    try {
      const photo = await preparePhoto(file);
      const imageUrl = await saveProjectPhoto(itemId, photo, uploadToken);
      setPhotos((current) => ({ ...current, [itemId]: photo }));
      onProductImageChange(itemId, imageUrl);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The image could not be loaded.");
    }
  };

  const importFolder = async (files: FileList) => {
    setIsImporting(true);
    setError("");
    setImportStatus("");
    const imported: Record<number, ProductPhoto> = {};
    const unmatched: string[] = [];
    const failed: string[] = [];
    const claimedItems = new Set<number>();
    const aliases: Record<string, string> = {
      pencil: "Pencils",
      gem: "Gem Rooks",
    };

    try {
      const imageFiles = Array.from(files)
        .filter((file) => file.type.startsWith("image/"))
        .sort((left, right) => left.webkitRelativePath.localeCompare(right.webkitRelativePath));

      for (const file of imageFiles) {
        const pathParts = file.webkitRelativePath.split("/");
        if (pathParts.length < 3) {
          unmatched.push(file.name);
          continue;
        }

        const categoryName = normalizeLabel(pathParts[pathParts.length - 2]);
        const originalName = file.name.replace(/\.[^.]+$/, "");
        const aliasedName = aliases[normalizeLabel(originalName)] || originalName;
        const item = crackerCatalog.find((candidate) =>
          normalizeLabel(candidate.category) === categoryName &&
          normalizeLabel(candidate.name) === normalizeLabel(aliasedName),
        );
        if (!item || claimedItems.has(item.id)) {
          unmatched.push(file.name);
          continue;
        }

        try {
          const photo = await preparePhoto(file);
          const imageUrl = await saveProjectPhoto(item.id, photo, uploadToken);
          imported[item.id] = photo;
          onProductImageChange(item.id, imageUrl);
          claimedItems.add(item.id);
        } catch (cause) {
          failed.push(`${file.name}: ${cause instanceof Error ? cause.message : "could not be loaded"}`);
        }
      }

      setPhotos((current) => ({ ...current, ...imported }));
      const result = `Imported ${Object.keys(imported).length} photos from ${imageFiles.length} image files.`;
      const skipped = unmatched.length
        ? ` ${unmatched.length} file${unmatched.length === 1 ? "" : "s"} did not match a catalog item and were skipped: ${unmatched.slice(0, 6).join(", ")}${unmatched.length > 6 ? ", and more" : ""}.`
        : "";
      const failedResult = failed.length
        ? ` ${failed.length} image${failed.length === 1 ? "" : "s"} could not be loaded: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? "; and more" : ""}.`
        : "";
      setImportStatus(`${result}${skipped}${failedResult}`);
    } catch (cause) {
      setError(cause instanceof Error ? `Folder import failed: ${cause.message}` : "Folder import failed.");
    } finally {
      setIsImporting(false);
    }
  };

  const handleDownload = () => {
    try {
      setIsDownloading(true);
      setError("");
      downloadCatalog();
    } catch (cause) {
      setError(cause instanceof Error ? `PDF could not be created: ${cause.message}` : "PDF could not be created.");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <main className="catalog-maker">
      <header className="catalog-maker-header">
        <div>
          <p className="catalog-maker-kicker">SLV CRACKERS / PDF BUILDER</p>
          <h1>Create your illustrated price list</h1>
          <p>Upload photos here to save them on the production server. They will appear on the website and price-list PDF for every visitor.</p>
        </div>
        <button className="catalog-download" type="button" onClick={handleDownload} disabled={isDownloading}>
          {isDownloading ? "Preparing PDF..." : "Download PDF"}
        </button>
      </header>

      {storageError && <p className="catalog-maker-error" role="alert">{storageError}</p>}
      <section className="catalog-maker-tools" aria-label="Find products">
        <label>
          Search products
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Type an item name" />
        </label>
        <label>
          Category
          <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
            <option>All categories</option>
            {categories.map((category) => <option key={category}>{category}</option>)}
          </select>
        </label>
        <label>
          Photo upload token
          <input
            type="password"
            name="photo-upload-token"
            autoComplete="off"
            value={uploadToken}
            onChange={(event) => setUploadToken(event.target.value)}
            placeholder="Enter the server token"
          />
        </label>
        <p>{Object.keys(photos).length} of {crackerCatalog.length} photos added</p>
        <label className="catalog-folder-button">
          {isImporting ? "Importing folder..." : "Import photos folder"}
          <input
            ref={folderInput}
            type="file"
            accept="image/*"
            multiple
            disabled={isImporting}
            onChange={(event) => {
              const files = event.currentTarget.files;
              if (files?.length) void importFolder(files);
              event.currentTarget.value = "";
            }}
            aria-label="Import product photos from a folder"
          />
        </label>
      </section>

      {error && <p className="catalog-maker-error" role="alert">{error}</p>}
      {importStatus && <p className="catalog-maker-status" role="status">{importStatus}</p>}

      <section className="catalog-maker-list" aria-label="Catalog products">
        {visibleItems.map((item) => (
          <article className="catalog-maker-row" key={item.id}>
            <div className="catalog-maker-photo">
              {photos[item.id] || publishedImages.has(item.id)
                ? <img src={photos[item.id]?.data ?? publishedImages.get(item.id)} alt={`${item.name} product`} />
                : <span>No photo yet</span>}
            </div>
            <div className="catalog-maker-details">
              <span>{item.category}</span>
              <h2>{item.name}</h2>
              <strong>{money(item.price)}</strong>
            </div>
            <div className="catalog-maker-actions">
              <label className="catalog-photo-button">
                {photos[item.id] ? "Change photo" : "Add photo"}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void attachPhoto(item.id, file);
                    event.currentTarget.value = "";
                  }}
                  aria-label={`${photos[item.id] ? "Change" : "Add"} photo for ${item.name}`}
                />
              </label>
              {photos[item.id] && (
                <button
                  className="catalog-remove-photo"
                  type="button"
                  onClick={async () => {
                    try {
                      await removeProjectPhoto(item.id, uploadToken);
                      setPhotos((current) => {
                        const next = { ...current };
                        delete next[item.id];
                        return next;
                      });
                      onProductImageChange(item.id, null);
                      setError("");
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "Photo could not be removed from the project.");
                    }
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </article>
        ))}
        {visibleItems.length === 0 && <p className="catalog-empty">No products match your search.</p>}
      </section>

      <div className="catalog-maker-bottom">
        <span>{crackerCatalog.length} products will be arranged by category in the {pdfPageCount}-page PDF.</span>
        <button className="catalog-download" type="button" onClick={handleDownload} disabled={isDownloading}>
          {isDownloading ? "Preparing PDF..." : "Download category price list"}
        </button>
      </div>
    </main>
  );
}
