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
const productsPerPage = 32;
const pdfPageCount = Math.ceil(crackerCatalog.length / productsPerPage);

function normalizeLabel(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
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

function downloadCatalog(photos: Record<number, ProductPhoto>) {
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const columns = 4;
  const gap = 2;
  const contentWidth = pageWidth - margin * 2;
  const cardWidth = (contentWidth - gap * (columns - 1)) / columns;
  const cardHeight = 20;
  const contentTop = 29;

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
    pdf.setFontSize(7);
    pdf.text("ILLUSTRATED PRICE LIST - PRICES IN INDIAN RUPEES (INR)", margin, 26);
  };

  for (let page = 0; page < pdfPageCount; page += 1) {
    if (page > 0) pdf.addPage();
    drawPageHeader();
    const pageItems = crackerCatalog.slice(page * productsPerPage, (page + 1) * productsPerPage);
    pageItems.forEach((item, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = margin + column * (cardWidth + gap);
      const y = contentTop + row * (cardHeight + 1.5);

      pdf.setDrawColor(226, 220, 233);
      pdf.setFillColor(250, 248, 252);
      pdf.roundedRect(x, y, cardWidth, cardHeight, 1.2, 1.2, "FD");
      const photo = photos[item.id];
      if (photo) {
        const imageBox = 16;
        const dimensions = pdf.getImageProperties(photo.data);
        const scale = Math.min(imageBox / dimensions.width, imageBox / dimensions.height);
        const imageWidth = dimensions.width * scale;
        const imageHeight = dimensions.height * scale;
        pdf.addImage(
          photo.data,
          "JPEG",
          x + 2 + (imageBox - imageWidth) / 2,
          y + 2 + (imageBox - imageHeight) / 2,
          imageWidth,
          imageHeight,
        );
      } else {
        pdf.setFillColor(238, 235, 242);
        pdf.roundedRect(x + 2, y + 2, 16, 16, 1, 1, "F");
        pdf.setTextColor(112, 105, 120);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(5);
        pdf.text("NO PHOTO", x + 10, y + 11, { align: "center" });
      }

      const textX = x + 21;
      const textWidth = cardWidth - 23;
      pdf.setTextColor(115, 47, 174);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(5);
      pdf.text(item.category.toUpperCase(), textX, y + 5, { maxWidth: textWidth });
      pdf.setTextColor(42, 31, 57);
      pdf.setFontSize(7);
      const nameLines = pdf.splitTextToSize(item.name, textWidth).slice(0, 2);
      pdf.text(nameLines, textX, y + 10);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      pdf.text(money(item.price), textX, y + 18, { maxWidth: textWidth });
    });
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
  pdf.save("SLV_Crackers_Illustrated_Price_List.pdf");
}

export default function CatalogMaker({
  products,
  onProductImageChange,
}: {
  products: CatalogProduct[];
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

  const attachPhoto = async (itemId: number, file: File) => {
    try {
      const photo = await preparePhoto(file);
      setPhotos((current) => ({ ...current, [itemId]: photo }));
      onProductImageChange(itemId, photo.data);
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
          imported[item.id] = await preparePhoto(file);
          claimedItems.add(item.id);
        } catch (cause) {
          failed.push(`${file.name}: ${cause instanceof Error ? cause.message : "could not be loaded"}`);
        }
      }

      setPhotos((current) => ({ ...current, ...imported }));
      Object.entries(imported).forEach(([itemId, photo]) => {
        onProductImageChange(Number(itemId), photo.data);
      });
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
      downloadCatalog(photos);
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
          <p>Photo changes save to the customer site in this browser immediately. Items without a photo will still appear with their name and price.</p>
        </div>
        <button className="catalog-download" type="button" onClick={handleDownload} disabled={isDownloading}>
          {isDownloading ? "Preparing PDF..." : "Download PDF"}
        </button>
      </header>

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
              {photos[item.id]
                ? <img src={photos[item.id].data} alt={`${item.name} product`} />
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
                  onClick={() => {
                    setPhotos((current) => {
                      const next = { ...current };
                      delete next[item.id];
                      return next;
                    });
                    onProductImageChange(item.id, null);
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
        <span>{crackerCatalog.length} products will be included in the {pdfPageCount}-page PDF.</span>
        <button className="catalog-download" type="button" onClick={handleDownload} disabled={isDownloading}>
          {isDownloading ? "Preparing PDF..." : "Download illustrated price list"}
        </button>
      </div>
    </main>
  );
}
