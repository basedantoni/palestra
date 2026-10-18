import {
  Apple,
  ArrowLeftRight,
  Baby,
  Banknote,
  Bike,
  BookOpen,
  Bus,
  Car,
  Coffee,
  CreditCard,
  Droplet,
  Dumbbell,
  Film,
  Fuel,
  Gamepad2,
  Gift,
  Hammer,
  HandCoins,
  HeartPulse,
  House,
  Landmark,
  type LucideIcon,
  MapPin,
  Music,
  PawPrint,
  Pill,
  Pizza,
  Plane,
  Receipt,
  Scissors,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sofa,
  Stethoscope,
  Ticket,
  TrainFront,
  Utensils,
  Wifi,
  Wine,
  Wrench,
  Zap,
} from "lucide-react";

import type { CategoryIcon } from "@life-tracker/shared";
import { cn } from "@/lib/utils";

import { CategorySwatch, categoryColor } from "./category-color";

/** Every picker icon's component; named imports, so only these 42 are bundled. */
export const CATEGORY_ICON_COMPONENTS: Record<CategoryIcon, LucideIcon> = {
  utensils: Utensils,
  coffee: Coffee,
  pizza: Pizza,
  apple: Apple,
  wine: Wine,
  "shopping-cart": ShoppingCart,
  "shopping-bag": ShoppingBag,
  car: Car,
  fuel: Fuel,
  bus: Bus,
  "train-front": TrainFront,
  plane: Plane,
  bike: Bike,
  "map-pin": MapPin,
  house: House,
  hammer: Hammer,
  zap: Zap,
  droplet: Droplet,
  wifi: Wifi,
  smartphone: Smartphone,
  sofa: Sofa,
  "heart-pulse": HeartPulse,
  pill: Pill,
  stethoscope: Stethoscope,
  dumbbell: Dumbbell,
  scissors: Scissors,
  shirt: Shirt,
  baby: Baby,
  film: Film,
  music: Music,
  "gamepad-2": Gamepad2,
  ticket: Ticket,
  "book-open": BookOpen,
  gift: Gift,
  "paw-print": PawPrint,
  banknote: Banknote,
  "arrow-left-right": ArrowLeftRight,
  "credit-card": CreditCard,
  receipt: Receipt,
  "hand-coins": HandCoins,
  landmark: Landmark,
  wrench: Wrench,
};

/**
 * How a category shows beside its name: its icon in its color, or its color
 * swatch when it has no icon. Uncategorized (no category) is a dashed swatch.
 */
export function CategoryMark({
  category,
  className,
}: {
  category: { color: string | null; icon: string | null } | null;
  className?: string;
}) {
  const Icon = category?.icon ? CATEGORY_ICON_COMPONENTS[category.icon as CategoryIcon] : undefined;
  if (!Icon) {
    return (
      <span className={cn("flex size-4 shrink-0 items-center justify-center", className)}>
        <CategorySwatch color={category?.color ?? null} uncategorized={!category} />
      </span>
    );
  }
  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} style={{ color: categoryColor(category!.color) }} />;
}
