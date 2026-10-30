import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>ReviewNest</h1>
        <p className={styles.text}>
          Collect, moderate, and showcase trusted product reviews from your
          Shopify store.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Review moderation</strong>. Approve, reject, and manage
            customer feedback without leaving the admin.
          </li>
          <li>
            <strong>CSV imports</strong>. Bulk-import reviews with validation,
            duplicate checks, and structured row previews.
          </li>
          <li>
            <strong>Widget automation</strong>. Publish reviews, trigger request
            emails, and keep your storefront content fresh.
          </li>
        </ul>
      </div>
    </div>
  );
}
