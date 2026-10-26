(() => {
  const blocks = document.querySelectorAll(
    "[data-rn-widget], [data-rn-star-rating]",
  );
  if (!blocks.length) return;

  const request = async (path, options = {}) => {
    const response = await fetch(path, { credentials: "omit", ...options });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Request failed.");
    return payload;
  };

  const reviewPath = (block) => {
    const prefix = block.dataset.proxyPrefix || "/apps/reviewnest";
    return `${prefix}/reviews`;
  };

  const loadRating = async (block, cursor) => {
    const params = new URLSearchParams({ productId: block.dataset.productId });
    if (cursor) params.set("cursor", cursor);
    return request(`${reviewPath(block)}?${params.toString()}`);
  };

  const renderReviews = (container, reviews) => {
    for (const review of reviews) {
      const article = document.createElement("article");
      article.className = "rn-review";
      const stars = document.createElement("div");
      stars.className = "rn-review__stars";
      stars.textContent = `${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}`;
      stars.setAttribute("aria-label", `${review.rating} out of 5 stars`);
      const title = document.createElement("h3");
      title.textContent = review.title || "Customer review";
      const meta = document.createElement("p");
      meta.className = "rn-review__meta";
      meta.textContent = `${review.reviewerName} · ${new Date(review.submittedAt).toLocaleDateString()}`;
      const body = document.createElement("p");
      body.className = "rn-review__body";
      body.textContent = review.body;
      article.append(stars, title, meta, body);
      if (review.verified) {
        const badge = document.createElement("span");
        badge.className = "rn-review__verified";
        badge.textContent = "Verified purchase";
        article.append(badge);
      }
      for (const media of review.media || []) {
        if (!media.url || !media.mimeType?.startsWith("image/")) continue;
        const image = document.createElement("img");
        image.src = media.url;
        image.alt = "Customer review attachment";
        image.loading = "lazy";
        article.append(image);
      }
      container.append(article);
    }
  };

  const initializeWidget = async (block) => {
    const reviewsContainer = block.querySelector("[data-rn-reviews]");
    const summary = block.querySelector("[data-rn-summary]");
    const moreButton = block.querySelector("[data-rn-more]");
    const form = block.querySelector("[data-rn-form]");
    const message = block.querySelector("[data-rn-message]");
    let cursor = null;
    try {
      const result = await loadRating(block);
      renderReviews(reviewsContainer, result.reviews);
      if (result.reviews.length) {
        summary.textContent = `${result.averageRating?.toFixed(1) || "0.0"} out of 5 · ${result.total} reviews`;
      } else {
        summary.textContent = "No published reviews yet.";
      }
      cursor = result.nextCursor;
      moreButton.hidden = !cursor;
    } catch {
      summary.textContent = "Reviews are temporarily unavailable.";
    }

    moreButton.addEventListener("click", async () => {
      if (!cursor) return;
      moreButton.disabled = true;
      try {
        const result = await loadRating(block, cursor);
        renderReviews(reviewsContainer, result.reviews);
        cursor = result.nextCursor;
        moreButton.hidden = !cursor;
      } catch {
        message.textContent = "Could not load more reviews. Try again.";
      } finally {
        moreButton.disabled = false;
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      message.textContent = "Submitting…";
      try {
        const formData = new FormData(form);
        formData.set("productId", block.dataset.productId);
        const result = await request(reviewPath(block), {
          method: "POST",
          body: formData,
        });
        message.textContent =
          result.status === "pending"
            ? "Thanks. Your review is awaiting moderation."
            : "Thank you for your review.";
        if (result.status === "published") form.reset();
      } catch (error) {
        message.textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    });
  };

  for (const block of blocks) {
    if (block.matches("[data-rn-star-rating]")) {
      loadRating(block)
        .then((result) => {
          const { reviews } = result;
          const stars = block.querySelector("[data-rn-stars]");
          const text = block.querySelector("[data-rn-rating-text]");
          if (!reviews.length) return;
          const average =
            reviews.reduce((sum, review) => sum + review.rating, 0) /
            reviews.length;
          stars.textContent = `${"★".repeat(Math.round(average))}${"☆".repeat(5 - Math.round(average))}`;
          text.textContent = `${average.toFixed(1)} (${reviews.length})`;
        })
        .catch(() => {});
    }
    if (block.matches("[data-rn-widget]")) initializeWidget(block);
  }
})();
