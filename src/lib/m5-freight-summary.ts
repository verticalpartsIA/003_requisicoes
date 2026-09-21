// Resumo legível dos campos estruturados do M5 (Frete) — usado nas telas de
// Cotação e Aprovação, que hoje só mostram título/justificativa e nunca
// module_data. Sem isso, quem cota/aprova não via nem sabia que o
// requisitante pediu Munck/paleteira/ajudantes (só aparecia no PDF final).

const VEHICLE_LABELS: Record<string, string> = {
  TRUCK: "Caminhão Truck",
  VAN: "Van/Furgão",
  FLATBED: "Prancha",
  CONTAINER: "Container",
  BAU: "Caminhão Baú",
  CARRETA: "Caminhão Carreta",
  OTHER: "Outro",
};

const CARGO_TYPE_LABELS: Record<string, string> = {
  ELEVADOR: "Elevador",
  EQUIPAMENTO: "Equipamento",
  MATERIAL_CONSTRUCAO: "Material de Construção",
  OUTRO: "Outro",
};

const MUNCK_SIZE_LABELS: Record<string, string> = {
  "10_15": "10 a 15 toneladas",
  "20_25": "20 a 25 toneladas",
  "30_35": "30 a 35 toneladas",
  "40_45": "40 a 45 toneladas",
  "50": "50 toneladas",
};

const EQUIPMENT_LABELS: Record<string, string> = {
  paleteira: "Paleteira",
  paleteira_eletrica: "Paleteira elétrica",
  cinta_elevacao: "Cinta de elevação",
  ganchos: "Ganchos",
  ajudante: "Ajudante",
  outro: "Outros",
};

export interface M5SummaryItem {
  label: string;
  value: string;
}

export function getM5SummaryItems(
  moduleData: Record<string, unknown> | undefined,
): M5SummaryItem[] {
  if (!moduleData) return [];
  const items: M5SummaryItem[] = [];
  const s = (v: unknown) => (v != null && v !== "" ? String(v) : null);

  const clientName = s(moduleData.client_name);
  const projectNumber = s(moduleData.project_number);
  if (clientName || projectNumber) {
    items.push({
      label: "Cliente/Projeto",
      value: [clientName, projectNumber].filter(Boolean).join(" — "),
    });
  }

  const origin = s(moduleData.origin_address);
  const destination = s(moduleData.destination_address);
  if (origin || destination) {
    items.push({ label: "Rota", value: `${origin ?? "—"} → ${destination ?? "—"}` });
  }

  const vehicleType = s(moduleData.vehicle_type);
  if (vehicleType) {
    items.push({ label: "Tipo de Veículo", value: VEHICLE_LABELS[vehicleType] ?? vehicleType });
  }

  const cargoType = s(moduleData.cargo_type);
  if (cargoType) {
    items.push({ label: "Tipo de Carga", value: CARGO_TYPE_LABELS[cargoType] ?? cargoType });
  }

  const elevatorItems = (moduleData.elevator_items ?? []) as Array<Record<string, unknown>>;
  if (elevatorItems.length > 0) {
    const summary = elevatorItems
      .map((it) => {
        const parts = [
          it.model ? String(it.model) : null,
          it.capacity_kg != null ? `${it.capacity_kg} kg` : null,
          it.stops != null ? `${it.stops} paradas` : null,
        ].filter(Boolean);
        return parts.join(" · ") || "Elevador";
      })
      .join("; ");
    items.push({
      label: `Elevador${elevatorItems.length > 1 ? `es (${elevatorItems.length})` : ""}`,
      value: summary,
    });
  }

  if (moduleData.needs_transport) {
    const cap = moduleData.vehicle_capacity_ton;
    const len = moduleData.vehicle_length_m;
    const extra = [cap != null ? `${cap} ton` : null, len != null ? `${len} m` : null]
      .filter(Boolean)
      .join(" · ");
    items.push({ label: "Serviço de Transporte", value: extra ? `Sim (${extra})` : "Sim" });
  }

  if (moduleData.needs_munck) {
    const qty = moduleData.munck_quantity;
    const size = s(moduleData.munck_size);
    const sizeLabel = size
      ? (MUNCK_SIZE_LABELS[size] ?? s(moduleData.munck_size_other) ?? size)
      : null;
    const hours = moduleData.munck_usage_hours;
    const parts = [
      qty != null ? `${qty}x` : null,
      sizeLabel,
      hours != null ? `~${hours}h de uso` : null,
    ].filter(Boolean);
    items.push({ label: "Locação de Munck", value: parts.length ? parts.join(" · ") : "Sim" });
  }

  const additionalEquipment = (moduleData.additional_equipment ?? []) as Array<
    Record<string, unknown>
  >;
  if (additionalEquipment.length > 0) {
    const summary = additionalEquipment
      .map((eq) => {
        const label = EQUIPMENT_LABELS[String(eq.type)] ?? String(eq.type);
        const qty = eq.quantity != null ? ` x${eq.quantity}` : "";
        const spec = eq.spec ? ` (${eq.spec})` : "";
        return `${label}${qty}${spec}`;
      })
      .join(", ");
    items.push({ label: "Equipamento Adicional", value: summary });
  }

  const weight = moduleData.weight_kg;
  if (weight != null) {
    items.push({ label: "Peso", value: `${weight} kg` });
  }

  return items;
}
