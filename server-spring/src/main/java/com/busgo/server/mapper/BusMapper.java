package com.busgo.server.mapper;

import com.busgo.server.dto.BusDto;
import com.busgo.server.entity.Bus;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper(componentModel = "spring")
public interface BusMapper {
    @Mapping(source = "conductor.id", target = "conductorId")
    BusDto toDto(Bus bus);
}
